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

/**
 * The dense alphabet: every printable ASCII character a WHATWG-parsing
 * browser keeps verbatim in a fragment (the parser percent-encodes only
 * space, `"`, `<`, `>` and the backtick there), except "." (the tag
 * separator), "%" (percent-decoding would eat it) and "~" (the marker and
 * preview suffix — keeping it out of the digits means a dense payload can
 * never END with "~", so `~…~` is always dense-plus-preview). 87 symbols
 * is log2(87) ≈ 6.44 bits a character against Base64url's 6 — several
 * characters saved on a long link, bought with exactly the characters
 * chat apps like to cut links at. Opt-in, like emoji.
 */
const DENSE = B64 + "!$&'()*+,;=:@/?#[]{}|^\\";
const DENSE_BASE = BigInt(DENSE.length);
const DENSE_INDEX = new Map([...DENSE].map((c, i) => [c, i]));
/**
 * The "~" marker — never a Base64url character or a dense digit — is worn
 * ONLY when the digits alone would be misread: a payload that happens to
 * use nothing but Base64url characters (indistinguishable from canonical),
 * or one that opens with a character the fragment grammar assigns a
 * meaning ("!" is the preview prefix, "s=" opens a prefill). Nearly every
 * dense payload contains punctuation Base64url cannot, which identifies it
 * for free — so dense is never longer than canonical, and shorter from
 * about eighteen payload characters up.
 */
const DENSE_MARK = "~";
/** A character only the dense alphabet uses — the free detection signal. */
const DENSE_ONLY = /[!$&'()*+,;=:@/?#[\]{}|^\\]/;

/** Is this fragment payload wearing the dense transport? */
export function isDense(payload) {
  return payload.startsWith(DENSE_MARK) || DENSE_ONLY.test(payload);
}

/**
 * Re-dress a canonical Base64url payload in the dense alphabet.
 *
 * The whole payload becomes one big integer with a leading 1 as sentinel
 * (so leading zero bits survive), written in base 87. Exact by
 * construction: BigInt arithmetic, no rounding anywhere.
 * @param {string} payload
 * @returns {string}
 */
export function toDense(payload) {
  let value = 1n;
  for (const c of payload) {
    const bits = DENSE_INDEX.get(c); // b64url is a prefix of DENSE
    value = (value << 6n) | BigInt(bits);
  }
  let out = "";
  while (value > 0n) {
    out = DENSE[Number(value % DENSE_BASE)] + out;
    value /= DENSE_BASE;
  }
  // The marker is paid only when the digits would be misread bare — and
  // when even the marked form is longer (tiny payloads), the canonical
  // spelling IS the best dense spelling: it decodes identically.
  const ambiguous = !DENSE_ONLY.test(out) || out.startsWith("!") || out.startsWith("s=");
  const dressed = ambiguous ? DENSE_MARK + out : out;
  return dressed.length <= payload.length ? dressed : payload;
}

/**
 * Undress a dense payload back to canonical Base64url.
 * @param {string} payload
 * @returns {string}
 * @throws {ClentError}
 */
export function fromDense(payload) {
  const digits = payload.startsWith(DENSE_MARK) ? payload.slice(1) : payload;
  let value = 0n;
  for (const c of digits) {
    const digit = DENSE_INDEX.get(c);
    if (digit === undefined)
      throw new ClentError("This link carries a character that doesn't belong.");
    value = value * DENSE_BASE + BigInt(digit);
  }
  if (value <= 1n) throw new ClentError("This link is empty.");
  // Pop 6-bit characters until only the sentinel bit remains.
  let out = "";
  while (value > 1n) {
    out = B64[Number(value & 63n)] + out;
    value >>= 6n;
  }
  if (value !== 1n) throw new ClentError("This link is damaged.");
  return out;
}

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
  if (isEmoji(payload)) return fromEmoji(payload);
  if (isDense(payload)) return fromDense(payload);
  return payload;
}
