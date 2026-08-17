/**
 * Canonical Huffman machinery, shared by the text code (textcode.js tables)
 * and the host code (hostcode.js tables).
 *
 * A code here is fully described by its lengths array: canonical assignment
 * orders symbols by (length, symbol) and hands out consecutive code values
 * per length, so encoder and decoder derive identical tables from the one
 * shipped list, and the tables stay data instead of trees.
 *
 * @module huffman
 */

import { BitWriter, BitReader, ClentError } from "./bits.js";

/** Longest code either shipped table uses; keeps the decode loop bounded. */
export const MAX_CODE_LEN = 15;

/**
 * @typedef {object} Code
 * @property {Int32Array} code code value per symbol (-1 = not coded)
 * @property {Uint8Array} len code length per symbol (0 = not coded)
 * @property {number[]} ordered symbols in canonical order
 * @property {Int32Array} firstCode first code value per length
 * @property {Int32Array} firstIndex first `ordered` index per length
 */

/**
 * Build the canonical code for a lengths array.
 * @param {readonly number[]} lengths
 * @returns {Code}
 */
export function buildCode(lengths) {
  const len = Uint8Array.from(lengths);
  const code = new Int32Array(len.length).fill(-1);
  /** @type {number[]} */
  const ordered = [];
  const firstCode = new Int32Array(MAX_CODE_LEN + 1);
  const firstIndex = new Int32Array(MAX_CODE_LEN + 1);

  for (let length = 1; length <= MAX_CODE_LEN; length++) {
    for (let symbol = 0; symbol < len.length; symbol++) {
      if (len[symbol] === length) ordered.push(symbol);
    }
  }
  let value = 0;
  let at = 0;
  for (let length = 1; length <= MAX_CODE_LEN; length++) {
    value <<= 1;
    firstCode[length] = value;
    firstIndex[length] = at;
    for (; at < ordered.length && len[ordered[at]] === length; at++) {
      code[ordered[at]] = value++;
    }
  }
  return { code, len, ordered, firstCode, firstIndex };
}

/**
 * Write one symbol's canonical code. BitWriter takes at most 8 bits a push,
 * so longer codes go out in two pieces.
 * @param {BitWriter} w
 * @param {Code} table
 * @param {number} symbol
 */
export function pushCode(w, table, symbol) {
  const length = table.len[symbol];
  const value = table.code[symbol];
  if (length > 8) {
    w.push(value >> 8, length - 8);
    w.push(value & 255, 8);
  } else {
    w.push(value, length);
  }
}

/**
 * Read one canonical symbol. A bit sequence that matches nothing in the
 * table is a damaged link, never a silently substituted symbol.
 * @param {BitReader} reader
 * @param {Code} table
 * @returns {number}
 */
export function readSymbol(reader, table) {
  let value = 0;
  for (let length = 1; length <= MAX_CODE_LEN; length++) {
    value = (value << 1) | reader.read(1);
    const offset = value - table.firstCode[length];
    const count =
      (length < MAX_CODE_LEN ? table.firstIndex[length + 1] : table.ordered.length) -
      table.firstIndex[length];
    if (offset >= 0 && offset < count) {
      return table.ordered[table.firstIndex[length] + offset];
    }
  }
  throw new ClentError("This link is damaged.");
}
