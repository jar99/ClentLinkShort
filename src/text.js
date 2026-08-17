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
 * @module text
 */

import { BitWriter, BitReader, ClentError } from "./bits.js";
import {
  CODE_LENGTHS, SYM_TOKEN, SYM_END, SYM_ESC, TOKEN_INDEX_BITS, TOKENS,
} from "./textcode.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Decoded text may never exceed this; the URL gate is far below it anyway. */
const MAX_TEXT_BYTES = 32768;

/* -------------------------------------------------------------------------- *
 * Canonical code construction
 *
 * The lengths array IS the code: canonical assignment orders symbols by
 * (length, symbol) and hands out consecutive codes per length, so encoder
 * and decoder derive identical tables from the one shipped list.
 * -------------------------------------------------------------------------- */

const MAX_LEN = 15;

/** @type {Int32Array} code value per symbol (-1 = not coded) */
const CODE = new Int32Array(CODE_LENGTHS.length).fill(-1);
/** @type {Uint8Array} code length per symbol (0 = not coded) */
const LEN = Uint8Array.from(CODE_LENGTHS);

/** Symbols in canonical order, and per-length decode windows. */
const ORDERED = [];
const FIRST_CODE = new Int32Array(MAX_LEN + 1);
const FIRST_INDEX = new Int32Array(MAX_LEN + 1);
{
  for (let length = 1; length <= MAX_LEN; length++) {
    for (let symbol = 0; symbol < LEN.length; symbol++) {
      if (LEN[symbol] === length) ORDERED.push(symbol);
    }
  }
  let code = 0;
  let at = 0;
  for (let length = 1; length <= MAX_LEN; length++) {
    code <<= 1;
    FIRST_CODE[length] = code;
    FIRST_INDEX[length] = at;
    for (; at < ORDERED.length && LEN[ORDERED[at]] === length; at++) {
      CODE[ORDERED[at]] = code++;
    }
  }
}

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

/** Write one symbol's canonical code. BitWriter takes at most 8 bits a push. */
function pushCode(w, symbol) {
  const length = LEN[symbol];
  const code = CODE[symbol];
  if (length > 8) {
    w.push(code >> 8, length - 8);
    w.push(code & 255, 8);
  } else {
    w.push(code, length);
  }
}

/**
 * The number of bits emitText() would write for these bytes, without writing
 * them. Used by the template scorer.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function textBits(bytes) {
  return planText(bytes).cost[0] + LEN[SYM_END];
}

/**
 * The token-or-literal plan for a body, by dynamic programming backwards from
 * the end: optimal against the measured costs, not greedy.
 * @param {Uint8Array} bytes
 */
function planText(bytes) {
  const n = bytes.length;
  const cost = new Int32Array(n + 1);
  /** -1 = emit a literal here, otherwise the token index to emit. */
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
 * Write a body as Huffman-coded text, terminated by END.
 * @param {BitWriter} w
 * @param {Uint8Array} bytes
 */
export function emitText(w, bytes) {
  const { choice } = planText(bytes);

  for (let i = 0; i < bytes.length;) {
    const pick = choice[i];
    if (pick >= 0) {
      pushCode(w, SYM_TOKEN);
      w.push(pick, TOKEN_INDEX_BITS);
      i += TOKEN_BYTES[pick].length;
      continue;
    }
    const byte = bytes[i++];
    if (LEN[byte]) {
      pushCode(w, byte);
    } else {
      pushCode(w, SYM_ESC);
      w.push(byte, 8);
    }
  }
  pushCode(w, SYM_END);
}

/**
 * Read one canonical symbol.
 * @param {BitReader} reader
 * @returns {number}
 */
function readSymbol(reader) {
  let code = 0;
  for (let length = 1; length <= MAX_LEN; length++) {
    code = (code << 1) | reader.read(1);
    const offset = code - FIRST_CODE[length];
    const count = (length < MAX_LEN ? FIRST_INDEX[length + 1] : ORDERED.length) -
      FIRST_INDEX[length];
    if (offset >= 0 && offset < count) {
      return ORDERED[FIRST_INDEX[length] + offset];
    }
  }
  throw new ClentError("This link is damaged.");
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
    const symbol = readSymbol(reader);
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
