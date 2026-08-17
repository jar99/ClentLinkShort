/**
 * The host field: a hostname in its own canonical Huffman code with two
 * kinds of dictionary symbol on top of the byte literals (hostcode.js,
 * mined by tools/mine-host.mjs):
 *
 *   terminals   registrable suffixes — ".com", ".co.uk", ".github.io" —
 *               one symbol that both appends the suffix and ends the field
 *   tokens      common fragments anywhere in the name — "blog.", "mail.",
 *               "admin.", "cloud" — ordinary symbols that keep going
 *
 * Between them an arbitrary domain stays cheap with no per-domain data:
 * "blog.example.com" is one token, seven cheap letters and one terminal.
 * Symbol choice is a shortest-path problem, solved by the same backwards
 * dynamic programme the text mode uses, against real per-symbol costs.
 *
 * @module host
 */

import { BitWriter, BitReader, ClentError } from "./bits.js";
import { buildCode, pushCode, readSymbol } from "./huffman.js";
import {
  HOST_CODE_LENGTHS, HOST_END, HOST_ESC, SUFFIX_BASE, SUFFIXES,
  HOST_TOKEN_BASE, HOST_TOKENS,
} from "./hostcode.js";

const HOST_CODE = buildCode(HOST_CODE_LENGTHS);
const HLEN = HOST_CODE.len;

/**
 * Longest host the decoder will reconstruct. DNS caps a name at 253
 * characters; the port adds a handful more.
 */
const MAX_HOST_CHARS = 260;

const HOST_ESC_COST = HLEN[HOST_ESC] + 8;

/** Bits to write one host byte: its own code, or ESC plus the raw byte. */
function hostLiteralCost(byte) {
  return HLEN[byte] || HOST_ESC_COST;
}

/**
 * Token indices keyed by first character — a flat 256-slot array for the
 * same reason as text.js's TOKEN_BY_FIRST: this is planHost's inner loop.
 * @type {Array<number[]|null>}
 */
const HOST_TOKEN_BY_FIRST = new Array(256).fill(null);
for (let i = 0; i < HOST_TOKENS.length; i++) {
  if (!HLEN[HOST_TOKEN_BASE + i]) continue;
  const first = HOST_TOKENS[i].charCodeAt(0);
  (HOST_TOKEN_BY_FIRST[first] ??= []).push(i);
}

/** Suffix indices keyed by final character, for the planner's terminals. */
const SUFFIX_BY_LAST = new Map();
for (let i = 0; i < SUFFIXES.length; i++) {
  if (!HLEN[SUFFIX_BASE + i]) continue;
  const last = SUFFIXES[i].charCodeAt(SUFFIXES[i].length - 1);
  if (!SUFFIX_BY_LAST.has(last)) SUFFIX_BY_LAST.set(last, []);
  SUFFIX_BY_LAST.get(last).push(i);
}

/**
 * Shortest-path plan for a host: literals, tokens, and how to end (a
 * suffix terminal absorbing the tail, or plain END).
 *
 * @param {string} host
 * @returns {{bits: number, choice: Int32Array}}
 *   choice[i]: -1 = literal, 0.. = token index, -2-k = stop with terminal k
 */
function planHost(host) {
  const n = host.length;
  const cost = new Int32Array(n + 1);
  // choice[i]: -1 = literal; 0..N-1 = token index; -2 - k = "stop here with
  // suffix terminal k". One array, no ambiguity at emit time.
  const choice = new Int32Array(n + 1).fill(-1);

  cost[n] = HLEN[HOST_END];
  choice[n] = -2 - SUFFIXES.length; // sentinel meaning plain END

  // The suffix-terminal candidates depend only on the host's LAST character,
  // so the list — and which of its entries actually end this host — is the
  // same at every position; resolve both once, not once per position.
  /** @type {number[]} */
  const endings = [];
  if (n > 0) {
    for (const index of SUFFIX_BY_LAST.get(host.charCodeAt(n - 1)) ?? []) {
      if (host.endsWith(SUFFIXES[index])) endings.push(index);
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    const byte = host.charCodeAt(i);
    // Cheapest way forward: literal or token, then the rest.
    let best = (HLEN[byte] || HOST_ESC_COST) + cost[i + 1];
    let pick = -1;
    const tokens = byte < 256 ? HOST_TOKEN_BY_FIRST[byte] : null;
    if (tokens !== null) {
      for (let t = 0; t < tokens.length; t++) {
        const index = tokens[t];
        const token = HOST_TOKENS[index];
        if (host.startsWith(token, i)) {
          const candidate = HLEN[HOST_TOKEN_BASE + index] + cost[i + token.length];
          if (candidate < best) {
            best = candidate;
            pick = index;
          }
        }
      }
    }
    // Or end right here: a suffix terminal that IS the remaining text.
    for (let e = 0; e < endings.length; e++) {
      const index = endings[e];
      if (n - i === SUFFIXES[index].length) {
        const candidate = HLEN[SUFFIX_BASE + index];
        if (candidate < best) {
          best = candidate;
          pick = -2 - index;
        }
      }
    }
    cost[i] = best;
    choice[i] = pick;
  }
  return { bits: cost[0], choice };
}

/**
 * The number of bits emitHost() would write for this host, without writing
 * them. Infinity for a host the decoder would refuse — the shape must never
 * enter the race, because winning it would produce a payload our own
 * decoder rejects.
 * @param {string} host
 * @returns {number}
 */
export function hostBits(host) {
  if (host.length > MAX_HOST_CHARS || !/^[\x00-\xff]*$/.test(host)) return Infinity;
  return planHost(host).bits;
}

/**
 * Write a host field: literals and tokens, then a suffix terminal or END.
 * URL hosts are ASCII (IDNs arrive punycoded); anything else rides ESC.
 * @param {BitWriter} w
 * @param {string} host
 */
export function emitHost(w, host) {
  // Mirror of the decoder's cap: emitting past it would make a payload that
  // decodeHost refuses, which is strictly worse than failing here.
  if (host.length > MAX_HOST_CHARS)
    throw new ClentError("That host is too long to encode.");
  const { choice } = planHost(host);

  let i = 0;
  for (;;) {
    const pick = choice[i];
    if (pick <= -2) {
      // Stop symbol: a suffix terminal, or plain END past the last char.
      const k = -2 - pick;
      pushCode(w, HOST_CODE, k === SUFFIXES.length ? HOST_END : SUFFIX_BASE + k);
      return;
    }
    if (pick >= 0) {
      pushCode(w, HOST_CODE, HOST_TOKEN_BASE + pick);
      i += HOST_TOKENS[pick].length;
      continue;
    }
    const byte = host.charCodeAt(i++);
    if (byte < 256 && HLEN[byte]) {
      pushCode(w, HOST_CODE, byte);
    } else if (byte < 256) {
      pushCode(w, HOST_CODE, HOST_ESC);
      w.push(byte, 8);
    } else {
      // Unreachable for URL-parsed hosts, which are ASCII; guard anyway.
      throw new ClentError("That host can't be encoded.");
    }
  }
}

/**
 * Read a host field back. Every malformed sequence is a ClentError, never a
 * silently substituted character.
 * @param {BitReader} reader
 * @returns {string}
 */
export function decodeHost(reader) {
  let host = "";
  for (;;) {
    const symbol = readSymbol(reader, HOST_CODE);
    if (symbol === HOST_END) break;
    if (symbol >= HOST_TOKEN_BASE) {
      const token = HOST_TOKENS[symbol - HOST_TOKEN_BASE];
      if (token === undefined)
        throw new ClentError("This link uses an unknown host token.");
      host += token;
    } else if (symbol >= SUFFIX_BASE) {
      const suffix = SUFFIXES[symbol - SUFFIX_BASE];
      if (suffix === undefined)
        throw new ClentError("This link uses an unknown host suffix.");
      host += suffix;
      break;
    } else {
      host += String.fromCharCode(symbol === HOST_ESC ? reader.read(8) : symbol);
    }
    if (host.length > MAX_HOST_CHARS)
      throw new ClentError("This link is damaged — the host is far too long.");
  }
  return host;
}
