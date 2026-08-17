#!/usr/bin/env node
/**
 * Mine the text-mode code from the corpus: a canonical Huffman code over body
 * bytes, and the substring token dictionary re-scored against real Huffman
 * costs.
 *
 * The two depend on each other — token worth is measured in the bits its
 * literals would have cost, and byte frequencies depend on which runs the
 * tokens swallow — so mining alternates the two until the sizes settle.
 *
 * Prints a src/textcode.js body and evaluation numbers; --write updates the
 * file in place.
 *
 * Usage:
 *   node tools/mine-text.mjs               # evaluate only
 *   node tools/mine-text.mjs --write
 *   node tools/mine-text.mjs --tokens 128
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { readCorpus } from "./corpus.js";
import { ROOT } from "./bundle.js";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const at = args.indexOf("--tokens");
const TOKEN_COUNT = at === -1 ? 128 : Number(args[at + 1]);
const TOKEN_INDEX_BITS = Math.ceil(Math.log2(TOKEN_COUNT));

const SAMPLE = 60000;
const HOLDOUT = 20000;
const MIN_LEN = 3, MAX_LEN = 12;
/** A token must appear across many hosts or it is one site's quirk. */
const MIN_HOSTS = 25;
/** Cap code length so the canonical decoder stays a small table. */
const MAX_CODE_LEN = 15;

/** Symbols: 0..255 bytes, then the three controls. */
const SYM_TOKEN = 256, SYM_END = 257, SYM_ESC = 258;
const SYMBOLS = 259;

const encoder = new TextEncoder();

/* -------------------------------------------------------------------------- *
 * Corpus bodies, as the encoder sees them
 * -------------------------------------------------------------------------- */

// In wire v1 the host almost always rides its own field (the host mode or
// the dictionary), so what the text code actually encodes is the tail. The
// host still travels alongside each body: token generality is judged by how
// many distinct hosts a substring spans, and that must come from the URL,
// not from the body text.
const bodies = [];
{
  let n = 0;
  for await (const url of readCorpus(SAMPLE + HOLDOUT)) {
    try {
      const p = new URL(url);
      let tail = p.href.slice(p.origin.length);
      if (tail === "/") tail = "";
      bodies.push({ bytes: encoder.encode(tail), host: p.host });
    } catch { /* not this tool's problem */ }
    if (++n >= SAMPLE + HOLDOUT) break;
  }
}
const sample = bodies.slice(0, SAMPLE);
const holdout = bodies.slice(SAMPLE);

/* -------------------------------------------------------------------------- *
 * Canonical Huffman over symbol frequencies
 * -------------------------------------------------------------------------- */

/**
 * Code lengths for the given frequencies: plain Huffman, then clamped to
 * MAX_CODE_LEN with the Kraft sum repaired by lengthening the cheapest codes.
 * @param {Float64Array} freq
 * @returns {Uint8Array} length per symbol; 0 = symbol not coded
 */
function huffmanLengths(freq) {
  const nodes = [];
  for (let s = 0; s < SYMBOLS; s++) {
    if (freq[s] > 0) nodes.push({ f: freq[s], syms: [s] });
  }
  if (nodes.length === 1) nodes.push({ f: 0, syms: [] });

  const lengths = new Uint8Array(SYMBOLS);
  const heap = [...nodes].sort((a, b) => a.f - b.f);
  while (heap.length > 1) {
    const a = heap.shift(), b = heap.shift();
    for (const s of a.syms) lengths[s]++;
    for (const s of b.syms) lengths[s]++;
    const merged = { f: a.f + b.f, syms: a.syms.concat(b.syms) };
    let i = 0;
    while (i < heap.length && heap[i].f <= merged.f) i++;
    heap.splice(i, 0, merged);
  }

  // Clamp and repair: force overlong codes to the cap, then restore the
  // Kraft inequality by lengthening the shortest codes until it holds.
  for (let s = 0; s < SYMBOLS; s++) {
    if (lengths[s] > MAX_CODE_LEN) lengths[s] = MAX_CODE_LEN;
  }
  const kraft = () => {
    let sum = 0;
    for (let s = 0; s < SYMBOLS; s++) if (lengths[s]) sum += 2 ** -lengths[s];
    return sum;
  };
  while (kraft() > 1) {
    let best = -1;
    for (let s = 0; s < SYMBOLS; s++) {
      if (lengths[s] && lengths[s] < MAX_CODE_LEN &&
          (best === -1 || lengths[s] < lengths[best] ||
           (lengths[s] === lengths[best] && freq[s] < freq[best]))) best = s;
    }
    lengths[best]++;
  }
  return lengths;
}

/* -------------------------------------------------------------------------- *
 * Cost model + greedy tokenisation for mining (the real encoder uses DP)
 * -------------------------------------------------------------------------- */

const litCost = (lengths, byte) =>
  lengths[byte] || lengths[SYM_ESC] + 8;

function bodyBits(lengths, tokens, body) {
  const tokenCost = lengths[SYM_TOKEN] + TOKEN_INDEX_BITS;
  let bits = lengths[SYM_END];
  let i = 0;
  outer: while (i < body.length) {
    for (const t of tokens) {
      if (t.bytes.length <= body.length - i) {
        let ok = true;
        for (let k = 0; k < t.bytes.length; k++) {
          if (body[i + k] !== t.bytes[k]) { ok = false; break; }
        }
        if (ok) { bits += tokenCost; i += t.bytes.length; continue outer; }
      }
    }
    bits += litCost(lengths, body[i++]);
  }
  return bits;
}

/** Byte + control frequencies over the sample, with tokens applied. */
function countFrequencies(lengths, tokens) {
  const freq = new Float64Array(SYMBOLS);
  for (const { bytes: body } of sample) {
    freq[SYM_END]++;
    let i = 0;
    outer: while (i < body.length) {
      for (const t of tokens) {
        if (t.bytes.length <= body.length - i) {
          let ok = true;
          for (let k = 0; k < t.bytes.length; k++) {
            if (body[i + k] !== t.bytes[k]) { ok = false; break; }
          }
          if (ok) { freq[SYM_TOKEN]++; i += t.bytes.length; continue outer; }
        }
      }
      freq[body[i++]]++;
    }
  }
  // Escape must stay codable even if no sampled byte needed it.
  if (!freq[SYM_ESC]) freq[SYM_ESC] = 1;
  return freq;
}

/**
 * Re-mine tokens against the current Huffman lengths.
 *
 * One n-gram counting pass is expensive, so tokens are selected in batches of
 * 32 per pass rather than one per pass; within a batch, candidates that
 * overlap an already-picked token are skipped so the batch approximation
 * stays close to the one-at-a-time answer.
 */
function mineTokens(lengths) {
  const decoder = new TextDecoder();
  const tokens = [];
  const chosen = new Set();
  const tokenCost = (lengths[SYM_TOKEN] || 8) + TOKEN_INDEX_BITS;
  const BATCH = 32;

  while (tokens.length < TOKEN_COUNT) {
    const counts = new Map();
    /** substring -> Set of distinct hosts it appeared under (size-capped) */
    const hosts = new Map();
    for (const { bytes, host } of sample.slice(0, 12000)) {
      const text = decoder.decode(bytes);
      // Residue after current tokens, greedy longest-match.
      let i = 0;
      const runs = [];
      let run = "";
      outer: while (i < text.length) {
        for (const t of tokens) {
          if (text.startsWith(t.text, i)) {
            if (run) { runs.push(run); run = ""; }
            i += t.text.length;
            continue outer;
          }
        }
        run += text[i++];
      }
      if (run) runs.push(run);

      for (const r of runs) {
        for (let n = MIN_LEN; n <= MAX_LEN; n++) {
          for (let j = 0; j + n <= r.length; j++) {
            const g = r.slice(j, j + n);
            if (chosen.has(g)) continue;
            counts.set(g, (counts.get(g) || 0) + 1);
            // Distinct hosts, actually distinct: the old counter incremented
            // once per BODY, which let one prolific site vote its own quirks
            // into the dictionary. The set is size-capped at the threshold.
            let seen = hosts.get(g);
            if (!seen) hosts.set(g, (seen = new Set()));
            if (seen.size <= MIN_HOSTS) seen.add(host);
          }
        }
      }
    }

    const scored = [];
    for (const [g, n] of counts) {
      if (n < 20 || (hosts.get(g)?.size ?? 0) < MIN_HOSTS) continue;
      let saved = -tokenCost;
      for (const ch of encoder.encode(g)) saved += litCost(lengths, ch);
      if (saved > 0) scored.push([g, n * saved]);
    }
    scored.sort((a, b) => b[1] - a[1]);

    let picked = 0;
    for (const [g] of scored) {
      if (tokens.length >= TOKEN_COUNT || picked >= BATCH) break;
      // Within a batch the counts don't know about each other, so avoid
      // stacking overlapping candidates whose savings would double-count.
      if (tokens.some((t) => t.text.includes(g) || g.includes(t.text))) continue;
      chosen.add(g);
      tokens.push({ text: g, bytes: encoder.encode(g) });
      picked++;
    }
    if (!picked) break;
    tokens.sort((a, b) => b.bytes.length - a.bytes.length);
  }
  return tokens;
}

/* -------------------------------------------------------------------------- *
 * Alternate until stable, then evaluate on the holdout
 * -------------------------------------------------------------------------- */

// Iteration zero: flat 6-bit-ish costs to bootstrap.
let lengths = new Uint8Array(SYMBOLS).fill(0);
for (let b = 32; b < 127; b++) lengths[b] = 6;
lengths[SYM_TOKEN] = 6; lengths[SYM_END] = 6; lengths[SYM_ESC] = 6;

let tokens = [];
for (let iteration = 0; iteration < 3; iteration++) {
  tokens = mineTokens(lengths);
  lengths = huffmanLengths(countFrequencies(lengths, tokens));
  const bits = sample.reduce((sum, b) => sum + bodyBits(lengths, tokens, b.bytes), 0);
  console.error(`iteration ${iteration}: ${tokens.length} tokens, ` +
    `${(bits / sample.length).toFixed(1)} bits/body on the sample`);
}

let heldBits = 0, heldChars = 0;
for (const { bytes } of holdout) {
  heldBits += bodyBits(lengths, tokens, bytes);
  heldChars += bytes.length;
}
console.error(`holdout: ${(heldBits / holdout.length).toFixed(1)} bits/body, ` +
  `${(heldBits / 6 / heldChars).toFixed(3)} payload chars per body char ` +
  `(flat text6 = ~1.0)`);

/* -------------------------------------------------------------------------- *
 * Emit
 * -------------------------------------------------------------------------- */

const lengthsLiteral = JSON.stringify([...lengths]);
const tokensLiteral = tokens.map((t) => JSON.stringify(t.text)).join(", ");

const file = `/**
 * The text-mode code: canonical Huffman lengths over body bytes plus the
 * three control symbols, and the substring token dictionary, both mined from
 * the corpus by tools/mine-text.mjs.
 *
 * Symbols 0..255 are bytes; 256 = TOKEN (an index follows), 257 = END,
 * 258 = ESC (a raw 8-bit byte follows). A length of 0 means the byte has no
 * code and is written via ESC. Codes are canonical: assigned by ascending
 * length, ties by ascending symbol, so the lengths array IS the whole code.
 *
 * Table format for wire v1. APPEND-ONLY in spirit: any change to either
 * table changes what existing payloads decode to, so a change here is a wire
 * version bump, never a patch.
 *
 * @module textcode
 */

/** Code length per symbol; index 256 TOKEN, 257 END, 258 ESC. */
export const CODE_LENGTHS = Object.freeze(${lengthsLiteral});

export const SYM_TOKEN = 256, SYM_END = 257, SYM_ESC = 258;

/** Width of a token index after the TOKEN symbol. */
export const TOKEN_INDEX_BITS = ${TOKEN_INDEX_BITS};

/**
 * The substring dictionary, indexed as on the wire.
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  ${tokensLiteral.replace(/(.{70,}?), /g, "$1,\n  ")}
]);
`;

if (WRITE) {
  await writeFile(path.join(ROOT, "src", "textcode.js"), file);
  console.error(`wrote src/textcode.js (${tokens.length} tokens, ` +
    `${[...lengths].filter(Boolean).length} coded symbols)`);
} else {
  console.log(file);
}
