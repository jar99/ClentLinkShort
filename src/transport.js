/**
 * Transport encodings: how payload bits travel inside the fragment.
 *
 * The canonical form is Base64url — 6 bits per character, and the only
 * alphabet that survives every chat app, terminal and clipboard. The emoji
 * form carries ~8 bits per glyph, so links LOOK about a quarter shorter
 * and are far more memorable — at the cost of more bytes on the wire (an
 * emoji is 4 UTF-8 bytes) and the occasional platform that mangles emoji.
 * It is an option, never the default.
 *
 * The mapping needs no table: a byte value is the single code point
 * U+1F400 plus it — 🐀 through 📿, a contiguous, fully-assigned block.
 *
 * Repacking 6-bit characters into 8-bit glyphs pads the tail with zero
 * bits, and unpacking cannot tell padding from a real final character —
 * for the raw and deflate body modes, which measure their length in whole
 * bytes, guessing wrong would append a phantom byte. So the first glyph
 * spends its top two bits on the canonical length mod 4; together with the
 * glyph count that pins the length exactly, with no guessing anywhere.
 *
 * Tags (`.c`/`.h`) always ride in ASCII after the payload, and integrity
 * is always computed over the canonical Base64url form, so the same link
 * carries the same tag in either dress.
 *
 * @module transport
 */

import { B64, BitReader, ClentError } from "./bits.js";

const EMOJI_BASE = 0x1f400;

/** Is this fragment payload wearing the emoji transport? */
export function isEmoji(payload) {
  const first = payload.codePointAt(0) ?? 0;
  return first >= EMOJI_BASE && first < EMOJI_BASE + 256;
}

/**
 * Re-dress a canonical Base64url payload as emoji.
 * @param {string} payload
 * @returns {string}
 */
export function toEmoji(payload) {
  const total = payload.length * 6;
  const reader = new BitReader(payload);
  const first = Math.min(6, total);
  let text = String.fromCodePoint(
    EMOJI_BASE + (((payload.length & 3) << 6) | (reader.read(first) << (6 - first))));
  for (let bit = first; bit < total; bit += 8) {
    const take = Math.min(8, total - bit);
    text += String.fromCodePoint(EMOJI_BASE + (reader.read(take) << (8 - take)));
  }
  return text;
}

/**
 * Undress an emoji payload back to canonical Base64url.
 * @param {string} payload
 * @returns {string}
 * @throws {ClentError} when a glyph is outside the block or lengths lie
 */
export function fromEmoji(payload) {
  const bytes = [];
  for (const glyph of payload) {
    const byte = glyph.codePointAt(0) - EMOJI_BASE;
    if (byte < 0 || byte > 255)
      throw new ClentError("This link mixes emoji with something else.");
    bytes.push(byte);
  }
  if (!bytes.length) throw new ClentError("This link is empty.");

  // Bit capacity after the 2-bit length header; the true length is the
  // unique n with that capacity and the announced residue mod 4.
  const capacity = bytes.length * 8 - 2;
  const mod = bytes[0] >> 6;
  let length = -1;
  for (let n = Math.floor(capacity / 6); n > 0 && n > capacity / 6 - 2; n--) {
    if ((n & 3) === mod && n * 6 <= capacity && n * 6 > capacity - 8) {
      length = n;
      break;
    }
  }
  if (length < 1) throw new ClentError("This link is damaged.");

  // Reassemble the bit stream: 6 data bits in glyph 0, then 8 per glyph.
  const bits = [];
  const pushBits = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  pushBits(bytes[0] & 63, 6);
  for (let i = 1; i < bytes.length; i++) pushBits(bytes[i], 8);

  let out = "";
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (let k = 0; k < 6; k++) value = (value << 1) | (bits[i * 6 + k] ?? 0);
    out += B64[value];
  }
  return out;
}

/**
 * Detect the transport and return the canonical Base64url payload.
 * @param {string} payload
 * @returns {string}
 */
export function decodeTransport(payload) {
  return isEmoji(payload) ? fromEmoji(payload) : payload;
}
