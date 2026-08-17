/**
 * The text body mode: canonical-Huffman-coded bytes with a substring token
 * dictionary, mined from the corpus (tools/mine-text.mjs, table in
 * textcode.js).
 *
 * Flat 6-bit text — one payload character per URL character — was the old
 * design, and it left real bits on the table: '/' , 'e' and 'a' are far more
 * common in URLs than 'Z' or '%'. Huffman coding the bytes takes the average
 * literal under 5 bits, capitals get ordinary (longer) codes instead of a
 * shift prefix, and the token dictionary rides in the same code as one more
 * symbol. Token selection is still a shortest-path problem, solved by the
 * same dynamic programme as before but with measured per-byte costs.
 *
 * The plan for a body is computed backwards from the end, so the plan for a
 * long body is simultaneously the plan for every suffix of it — the encoder
 * exploits that to price all its candidate splits with one plan.
 *
 * @module text
 */

import { BitWriter, BitReader, ClentError } from "./bits.js";
import { buildCode, pushCode, readSymbol } from "./huffman.js";
import {
  CODE_LENGTHS, SYM_TOKEN, SYM_END, SYM_ESC, TOKEN_INDEX_BITS, TOKENS,
} from "./textcode.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Decoded text may never exceed this; the URL gate is far below it anyway. */
const MAX_TEXT_BYTES = 32768;

const TEXT_CODE = buildCode(CODE_LENGTHS);
const LEN = TEXT_CODE.len;

/** Bits the terminating END symbol costs; part of every body's price. */
export const END_BITS = LEN[SYM_END];

/** @type {Uint8Array[]} tokens as bytes, indexed as on the wire */
const TOKEN_BYTES = TOKENS.map((token) => textEncoder.encode(token));
/** First byte -> token indices, so matching only considers plausible tokens. */
const TOKEN_BY_FIRST = new Map();
for (let i = 0; i < TOKEN_BYTES.length; i++) {
  const first = TOKEN_BYTES[i][0];
  if (!TOKEN_BY_FIRST.has(first)) TOKEN_BY_FIRST.set(first, []);
  TOKEN_BY_FIRST.get(first).push(i);
}

const ESC_COST = LEN[SYM_ESC] + 8;
const TOKEN_COST = LEN[SYM_TOKEN] + TOKEN_INDEX_BITS;

/** Bits to write one literal byte: its own code, or ESC plus the raw byte. */
function literalCost(byte) {
  return LEN[byte] || ESC_COST;
}

/**
 * @typedef {object} TextPlan
 * @property {Int32Array} cost cost[i] = bits to write bytes[i..] (END excluded)
 * @property {Int32Array} choice -1 = literal at i, else the token index to emit
 */

/**
 * The token-or-literal plan for a body, by dynamic programming backwards from
 * the end: optimal against the measured costs, not greedy. Because it runs
 * backwards, `cost[i]` and `choice[i]` are also the complete plan for the
 * suffix starting at `i`.
 * @param {Uint8Array} bytes
 * @returns {TextPlan}
 */
export function planText(bytes) {
  const n = bytes.length;
  const cost = new Int32Array(n + 1);
  const choice = new Int32Array(n + 1).fill(-1);

  for (let i = n - 1; i >= 0; i--) {
    let best = literalCost(bytes[i]) + cost[i + 1];
    let pick = -1;

    for (const index of TOKEN_BY_FIRST.get(bytes[i]) ?? []) {
      const token = TOKEN_BYTES[index];
      if (i + token.length > n) continue;
      let matched = true;
      for (let k = 1; k < token.length; k++) {
        if (bytes[i + k] !== token[k]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      const candidate = TOKEN_COST + cost[i + token.length];
      if (candidate < best) {
        best = candidate;
        pick = index;
      }
    }

    cost[i] = best;
    choice[i] = pick;
  }
  return { cost, choice };
}

/**
 * The number of bits emitText() would write for these bytes, without writing
 * them. Used by the template scorer.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function textBits(bytes) {
  return planText(bytes).cost[0] + END_BITS;
}

/**
 * Write a body as Huffman-coded text, terminated by END.
 *
 * With `plan` and `from` given, writes the suffix `bytes[from..]` of an
 * already-planned longer body instead of re-planning.
 *
 * @param {BitWriter} w
 * @param {Uint8Array} bytes
 * @param {TextPlan} [plan]
 * @param {number} [from]
 */
export function emitText(w, bytes, plan = planText(bytes), from = 0) {
  const { choice } = plan;

  for (let i = from; i < bytes.length;) {
    const pick = choice[i];
    if (pick >= 0) {
      pushCode(w, TEXT_CODE, SYM_TOKEN);
      w.push(pick, TOKEN_INDEX_BITS);
      i += TOKEN_BYTES[pick].length;
      continue;
    }
    const byte = bytes[i++];
    if (LEN[byte]) {
      pushCode(w, TEXT_CODE, byte);
    } else {
      pushCode(w, TEXT_CODE, SYM_ESC);
      w.push(byte, 8);
    }
  }
  pushCode(w, TEXT_CODE, SYM_END);
}

/**
 * Read a Huffman-coded text body back into a string, stopping at END.
 *
 * Every malformed sequence — truncation, an unknown token index, a code that
 * matches nothing — is a ClentError, never a silently substituted byte.
 *
 * @param {BitReader} reader
 * @returns {string}
 */
export function decodeText(reader) {
  /** @type {number[]} */
  const bytes = [];
  for (;;) {
    const symbol = readSymbol(reader, TEXT_CODE);
    if (symbol === SYM_END) break;
    if (symbol === SYM_ESC) {
      bytes.push(reader.read(8));
    } else if (symbol === SYM_TOKEN) {
      const token = TOKEN_BYTES[reader.read(TOKEN_INDEX_BITS)];
      if (!token) throw new ClentError("This link uses an unknown token.");
      for (const byte of token) bytes.push(byte);
    } else {
      bytes.push(symbol);
    }
    if (bytes.length > MAX_TEXT_BYTES)
      throw new ClentError("This link decodes to something far too long to be a URL.");
  }
  return textDecoder.decode(new Uint8Array(bytes));
}
