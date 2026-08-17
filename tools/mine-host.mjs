#!/usr/bin/env node
/**
 * Mine the host code from the corpus: a canonical Huffman code over hostname
 * bytes whose TERMINAL symbols are registrable suffixes, so ".com" — the
 * ending of roughly two in five unknown hosts — costs a couple of bits
 * instead of being spelled.
 *
 * This is what makes arbitrary domains cheap without a dictionary entry per
 * domain: the name part is short and the suffix part is drawn from a small,
 * stable set (TLDs, public SLDs like co.uk, and platform suffixes like
 * github.io). The suffix table is mined by measured savings, but a candidate
 * must appear across many distinct registrable names — one site's subdomains
 * cannot vote a private suffix in.
 *
 * Prints a src/hostcode.js body; --write updates the file in place.
 *
 * Usage:
 *   node tools/mine-host.mjs               # evaluate only
 *   node tools/mine-host.mjs --write
 *   node tools/mine-host.mjs --suffixes 96
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { readCorpus } from "./corpus.js";
import { ROOT } from "./bundle.js";
import { HOST_INDEX } from "../src/hosts.js";

const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const at = args.indexOf("--suffixes");
const SUFFIX_COUNT = at === -1 ? 192 : Number(args[at + 1]);
const tt = args.indexOf("--tokens");
const TOKEN_COUNT = tt === -1 ? 64 : Number(args[tt + 1]);

const SAMPLE = 120000;
const HOLDOUT = 30000;
/** A suffix must span this many distinct names before it or it is a quirk. */
const MIN_NAMES = 30;
const MAX_CODE_LEN = 15;

/**
 * Symbols: bytes, END, ESC, suffix terminals, then one per host token.
 * TOKEN_BASE tracks the suffixes actually SELECTED, not the count asked
 * for — when scoring surfaces fewer than SUFFIX_COUNT, an offset anchored
 * to the request would emit a lengths array misaligned with the file's
 * own HOST_TOKEN_BASE, leaving half the tokens pointing at padding.
 */
const HOST_END = 256, HOST_ESC = 257, SUFFIX_BASE = 258;
const TOKEN_BASE = () => SUFFIX_BASE + suffixes.length;

/* -------------------------------------------------------------------------- *
 * Hosts as the encoder sees them: www-stripped, weighted by occurrence
 * -------------------------------------------------------------------------- */

const sample = [];
const holdout = [];
{
  let n = 0;
  for await (const url of readCorpus(SAMPLE + HOLDOUT)) {
    try {
      const p = new URL(url);
      if (p.protocol !== "https:" && p.protocol !== "http:") continue;
      let host = p.host;
      if (host.startsWith("www.")) host = host.slice(4);
      // Dictionary hosts ride the 8-bit index; the host code is for the rest.
      if (HOST_INDEX.has(host)) continue;
      (n < SAMPLE ? sample : holdout).push(host);
    } catch { /* not this tool's problem */ }
    if (++n >= SAMPLE + HOLDOUT) break;
  }
}

/* -------------------------------------------------------------------------- *
 * Canonical Huffman lengths (same construction as mine-text)
 * -------------------------------------------------------------------------- */

function huffmanLengths(freq) {
  const SYMBOLS = freq.length;
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
 * Suffix candidates: dotted endings spanning many distinct names
 * -------------------------------------------------------------------------- */

/** Every dotted ending of a host, e.g. "a.b.co.uk" -> .uk .co.uk .b.co.uk */
function endingsOf(host) {
  const out = [];
  for (let i = host.length - 1; i > 0; i--) {
    if (host[i] === ".") out.push(host.slice(i));
  }
  return out;
}

function collectCandidates(hosts) {
  const count = new Map();  // suffix -> weighted occurrences
  const names = new Map();  // suffix -> Set of distinct names before it
  for (const host of hosts) {
    for (const suffix of endingsOf(host)) {
      count.set(suffix, (count.get(suffix) || 0) + 1);
      const name = host.slice(0, host.length - suffix.length);
      let set = names.get(suffix);
      if (!set) names.set(suffix, (set = new Set()));
      if (set.size <= MIN_NAMES) set.add(name);
    }
  }
  return { count, names };
}

/* -------------------------------------------------------------------------- *
 * Cost model
 * -------------------------------------------------------------------------- */

const litCost = (lengths, byte) => lengths[byte] || lengths[HOST_ESC] + 8;

/**
 * The cheapest way to end this host: the plain END symbol, or a terminal
 * whose suffix the host carries. Candidates compare on `termLen - spelled`,
 * because a terminal absorbs its suffix's spelled characters.
 *
 * @returns {{pick: number, margin: number, suffixLen: number}} pick -1 = END
 */
function bestTerminal(lengths, suffixes, host) {
  let pick = -1;
  let margin = lengths[HOST_END];
  let suffixLen = 0;
  for (let i = 0; i < suffixes.length; i++) {
    const s = suffixes[i];
    if (host.length <= s.length || !host.endsWith(s)) continue;
    // Unfit terminals (no code yet, first pass) get a middling estimate so
    // frequency counting can still discover them.
    const termLen = lengths[SUFFIX_BASE + i] || 10;
    let spelled = 0;
    for (let k = 0; k < s.length; k++) spelled += litCost(lengths, s.charCodeAt(k));
    if (termLen - spelled < margin) {
      pick = i;
      margin = termLen - spelled;
      suffixLen = s.length;
    }
  }
  return { pick, margin, suffixLen };
}

/** Greedy token cost for the name part (the real encoder uses DP). */
function nameBits(lengths, tokens, text) {
  let bits = 0;
  let i = 0;
  outer: while (i < text.length) {
    for (let t = 0; t < tokens.length; t++) {
      if (text.startsWith(tokens[t], i)) {
        bits += lengths[TOKEN_BASE() + t] || 10;
        i += tokens[t].length;
        continue outer;
      }
    }
    bits += litCost(lengths, text.charCodeAt(i++));
  }
  return bits;
}

/** Bits for one host under the given lengths, suffixes and tokens. */
function hostBits(lengths, suffixes, tokens, host) {
  const { margin, suffixLen } = bestTerminal(lengths, suffixes, host);
  // margin already subtracts the spelled suffix; approximate by pricing the
  // whole host then applying the terminal margin over plain literals.
  let bits = margin;
  bits += nameBits(lengths, tokens, host.slice(0, host.length - suffixLen));
  for (let k = host.length - suffixLen; k < host.length; k++) {
    bits += litCost(lengths, host.charCodeAt(k));
  }
  // bestTerminal's margin includes -spelled(suffix); the loop above re-adds
  // exactly those literals, so the sum is name + terminal (or +END).
  return bits;
}

/** Frequencies over the sample: suffix terminals and tokens included. */
function countFrequencies(lengths, suffixes, tokens) {
  const freq = new Float64Array(TOKEN_BASE() + tokens.length);
  for (const host of sample) {
    const { pick, suffixLen } = bestTerminal(lengths, suffixes, host);
    const name = host.slice(0, host.length - suffixLen);
    let i = 0;
    outer: while (i < name.length) {
      for (let t = 0; t < tokens.length; t++) {
        if (name.startsWith(tokens[t], i)) {
          freq[TOKEN_BASE() + t]++;
          i += tokens[t].length;
          continue outer;
        }
      }
      freq[name.charCodeAt(i++)]++;
    }
    if (pick >= 0) freq[SUFFIX_BASE + pick]++;
    else freq[HOST_END]++;
  }
  if (!freq[HOST_ESC]) freq[HOST_ESC] = 1;
  if (!freq[HOST_END]) freq[HOST_END] = 1;
  return freq;
}

/**
 * Mine host tokens from the name parts: substrings that recur across many
 * DISTINCT names — "blog.", "mail.", "cloud", "shop" — so one company's
 * subdomain farm can't vote its own quirks in.
 */
function mineHostTokens(lengths, suffixes) {
  const counts = new Map();
  const names = new Map();
  for (const host of sample) {
    const { suffixLen } = bestTerminal(lengths, suffixes, host);
    const name = host.slice(0, host.length - suffixLen);
    for (let n = 3; n <= 10; n++) {
      for (let j = 0; j + n <= name.length; j++) {
        const g = name.slice(j, j + n);
        counts.set(g, (counts.get(g) || 0) + 1);
        let set = names.get(g);
        if (!set) names.set(g, (set = new Set()));
        if (set.size <= 40) set.add(name);
      }
    }
  }
  const scored = [];
  for (const [g, n] of counts) {
    if (n < 40 || (names.get(g)?.size ?? 0) < 40) continue;
    let saved = -10; // estimated token cost pre-fit
    for (let k = 0; k < g.length; k++) saved += litCost(lengths, g.charCodeAt(k));
    if (saved > 0) scored.push([g, n * saved]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const tokens = [];
  for (const [g] of scored) {
    if (tokens.length >= TOKEN_COUNT) break;
    if (tokens.some((t) => t.includes(g) || g.includes(t))) continue;
    tokens.push(g);
  }
  tokens.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  return tokens;
}

/* -------------------------------------------------------------------------- *
 * Alternate: pick suffixes by measured savings, refit the code, repeat
 * -------------------------------------------------------------------------- */

const { count, names } = collectCandidates(sample);

// Bootstrap costs: flat-ish.
let suffixes = [];
let tokens = [];
let lengths = new Uint8Array(SUFFIX_BASE);
for (let b = 45; b < 123; b++) lengths[b] = 6;
lengths[HOST_END] = 6; lengths[HOST_ESC] = 6;

for (let iteration = 0; iteration < 3; iteration++) {
  // Score every candidate against current costs.
  const scored = [];
  for (const [suffix, n] of count) {
    if ((names.get(suffix)?.size ?? 0) < MIN_NAMES) continue;
    let saved = 0;
    for (let k = 0; k < suffix.length; k++) saved += litCost(lengths, suffix.charCodeAt(k));
    // A terminal costs roughly what END costs; the saving is the spelled part.
    if (saved > 0) scored.push([suffix, n * saved]);
  }
  scored.sort((a, b) => b[1] - a[1]);

  // Terminal lengths are indexed by position in `suffixes`, so when the
  // selection reorders between iterations, carry each suffix's previous
  // length over by name — misaligned indices would corrupt the cost model.
  const previous = new Map(suffixes.map((s, i) => [s, lengths[SUFFIX_BASE + i]]));
  suffixes = scored.slice(0, SUFFIX_COUNT).map(([s]) => s);
  suffixes.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const carried = new Uint8Array(SUFFIX_BASE + suffixes.length);
  carried.set(lengths.subarray(0, SUFFIX_BASE));
  for (let i = 0; i < suffixes.length; i++) {
    carried[SUFFIX_BASE + i] = previous.get(suffixes[i]) ?? 0;
  }

  tokens = mineHostTokens(carried, suffixes);
  lengths = huffmanLengths(countFrequencies(carried, suffixes, tokens));
  let bits = 0;
  for (const host of sample) bits += hostBits(lengths, suffixes, tokens, host);
  console.error(`iteration ${iteration}: ${suffixes.length} suffixes, ` +
    `${tokens.length} tokens, ${(bits / sample.length).toFixed(1)} bits/host`);
}

/* -------------------------------------------------------------------------- *
 * Holdout evaluation
 * -------------------------------------------------------------------------- */

{
  let bits = 0, chars = 0;
  for (const host of holdout) {
    bits += hostBits(lengths, suffixes, tokens, host);
    chars += host.length;
  }
  console.error(`holdout: ${(bits / holdout.length).toFixed(1)} bits/host, ` +
    `${(bits / 6 / chars).toFixed(3)} payload chars per host char`);
}

/* -------------------------------------------------------------------------- *
 * Emit
 * -------------------------------------------------------------------------- */

const lengthsLiteral = `[..."${[...lengths].map((v) => v.toString(16)).join("")}"].map((c) => parseInt(c, 16))`;
const suffixesLiteral = suffixes.map((s) => JSON.stringify(s)).join(", ");
const tokensLiteral = tokens.map((s) => JSON.stringify(s)).join(", ");

const file = `/**
 * The host code: canonical Huffman lengths over hostname bytes plus END,
 * ESC and one TERMINAL symbol per registrable suffix, mined from the corpus
 * by tools/mine-host.mjs.
 *
 * This is how an arbitrary domain stays cheap without a dictionary entry:
 * the name part is spelled in a code tuned to hostname letters, and the
 * suffix — ".com" for two in five unknown hosts — is one short symbol that
 * also ends the field. A host whose suffix is not listed ends with the plain
 * END symbol instead; nothing needs this table to grow per domain.
 *
 * Symbols 0..255 are bytes; 256 = END, 257 = ESC (a raw 8-bit byte
 * follows), 258+k = "append SUFFIXES[k], then end", and past those one
 * symbol per HOST_TOKEN — "blog.", "mail." and friends cost a few bits
 * instead of being spelled. Codes are canonical: assigned by ascending
 * length, ties by ascending symbol, so the lengths array IS the whole code.
 *
 * Beta: re-mining replaces these tables and invalidates existing links;
 * after 1.0 this file is frozen by test/compat.test.js.
 *
 * @module hostcode
 */

/** Code length per symbol (one hex digit each); 256 END, 257 ESC, 258+k terminals. */
export const HOST_CODE_LENGTHS = Object.freeze(${lengthsLiteral});

export const HOST_END = 256, HOST_ESC = 257, SUFFIX_BASE = 258;

/**
 * Suffix per terminal symbol, longest first so greedy matching is safe.
 * @type {readonly string[]}
 */
export const SUFFIXES = Object.freeze([
  ${suffixesLiteral.replace(/(.{70,}?), /g, "$1,\n  ")}
]);

/** First host-token symbol; token k lives at HOST_TOKEN_BASE + k. */
export const HOST_TOKEN_BASE = ${SUFFIX_BASE + suffixes.length};

/**
 * Common host fragments as their own symbols, indexed as on the wire.
 * @type {readonly string[]}
 */
export const HOST_TOKENS = Object.freeze([
  ${tokensLiteral.replace(/(.{70,}?), /g, "$1,\n  ")}
]);
`;

if (WRITE) {
  await writeFile(path.join(ROOT, "src", "hostcode.js"), file);
  console.error(`wrote src/hostcode.js (${suffixes.length} suffixes, ` +
    `${tokens.length} tokens, ${[...lengths].filter(Boolean).length} coded symbols)`);
} else {
  console.log(file);
}
