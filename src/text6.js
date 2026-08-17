/**
 * text6: the body encoding that packs URL text at 6 bits per character.
 *
 * Base64url is also 6 bits per character, so an ordinary lowercase URL comes
 * out of this at one payload character per input character — no expansion.
 * Symbols 0..58 are literal bytes from T6; TOKEN references the 64-entry
 * substring dictionary; SHIFT uppercases the next symbol; ESC carries one raw
 * byte; END terminates. Symbol 60 is unassigned and the decoder rejects it.
 *
 * @module text6
 */

import { BitWriter, BitReader, ClentError } from "./bits.js";
import { TOKENS } from "./tokens.js";

/**
 * text6 symbol table. Symbols 0..58 are literal bytes; the control symbols
 * below cover everything else. Symbol 60 is unassigned.
 */
export const T6 = "abcdefghijklmnopqrstuvwxyz0123456789/-_.?=&%+,:~#@!$*();'[]";
const T6_INDEX = new Map([...T6].map((c, i) => [c.charCodeAt(0), i]));

/** A 6-bit index into TOKENS follows. */
const TOKEN = 59;
/** Uppercase the next symbol. */
const SHIFT = 61;
/** One raw 8-bit byte follows. */
const ESC = 62;
/** End of body. */
const END = 63;

const t6Encoder = new TextEncoder();
const t6Decoder = new TextDecoder();

/** @type {Uint8Array[]} tokens as bytes, indexed as they are on the wire */
const TOKEN_BYTES = TOKENS.map((token) => t6Encoder.encode(token));
/** First byte -> token indices, so matching only considers plausible tokens. */
const TOKEN_BY_FIRST = new Map();
for (let i = 0; i < TOKEN_BYTES.length; i++) {
  const first = TOKEN_BYTES[i][0];
  if (!TOKEN_BY_FIRST.has(first)) TOKEN_BY_FIRST.set(first, []);
  TOKEN_BY_FIRST.get(first).push(i);
}

/** Bits to write one literal byte: direct symbol, SHIFT + symbol, or ESC + byte. */
function literalCost(byte) {
  if (T6_INDEX.has(byte)) return 6;
  if (byte >= 65 && byte <= 90 && T6_INDEX.has(byte + 32)) return 12;
  return 14;
}

/**
 * Write a body as text6, choosing tokens by dynamic programming.
 *
 * Greedy longest-match is the obvious approach and is not optimal: taking a
 * long token here can step over the start of a better one, or over a run of
 * cheap literals that would have let two tokens line up. Working backwards
 * from the end and keeping the best cost for every suffix gives the genuinely
 * smallest text6 encoding of the body, which is what the mode is then judged
 * on against raw and deflate.
 *
 * @param {BitWriter} w
 * @param {Uint8Array} bytes
 */
export function emitText6(w, bytes) {
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
      const candidate = 12 + cost[i + token.length];
      if (candidate < best) {
        best = candidate;
        pick = index;
      }
    }

    cost[i] = best;
    choice[i] = pick;
  }

  for (let i = 0; i < n;) {
    const pick = choice[i];
    if (pick >= 0) {
      w.push(TOKEN, 6);
      w.push(pick, 6);
      i += TOKEN_BYTES[pick].length;
      continue;
    }
    const byte = bytes[i++];
    const direct = T6_INDEX.get(byte);
    if (direct !== undefined) {
      w.push(direct, 6);
    } else if (byte >= 65 && byte <= 90 && T6_INDEX.has(byte + 32)) {
      w.push(SHIFT, 6);
      w.push(T6_INDEX.get(byte + 32), 6);
    } else {
      w.push(ESC, 6);
      w.push(byte, 8);
    }
  }
  w.push(END, 6);
}

/**
 * Read a text6 body back into a string, stopping at END.
 *
 * Every malformed sequence — truncation, an unknown token index, and the
 * unassigned symbol 60 — is a ClentError, never a silently substituted byte.
 *
 * @param {BitReader} reader
 * @returns {string}
 */
export function decodeText6(reader) {
  /** @type {number[]} */
  const bytes = [];
  let shifted = false;
  for (;;) {
    if (reader.left < 6) throw new ClentError("This link is truncated.");
    const symbol = reader.read(6);
    if (symbol === END) break;
    if (symbol === SHIFT) {
      shifted = true;
      continue;
    }
    if (symbol === ESC) {
      bytes.push(reader.read(8));
      shifted = false;
      continue;
    }
    if (symbol === TOKEN) {
      const token = TOKEN_BYTES[reader.read(6)];
      if (!token) throw new ClentError("This link uses an unknown token.");
      for (const byte of token) bytes.push(byte);
      shifted = false;
      continue;
    }
    // Symbol 60 is unassigned. Before this check it fell through to
    // charCodeAt -> NaN -> byte 0: a silently invented NUL in the body.
    if (symbol >= T6.length) throw new ClentError("This link is damaged.");
    const ch = T6.charCodeAt(symbol);
    bytes.push(shifted && ch >= 97 && ch <= 122 ? ch - 32 : ch);
    shifted = false;
  }
  return t6Decoder.decode(new Uint8Array(bytes));
}
