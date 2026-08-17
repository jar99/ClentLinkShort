/**
 * The bit stream: a continuous sequence of 1..8-bit values written straight
 * into the Base64url alphabet at 6 bits per character. Nothing rounds up to a
 * byte, so nothing is wasted.
 *
 * ClentError lives here too — it is the error type for the whole codec, and
 * this is the one module everything else can import without a cycle.
 *
 * @module bits
 */

/** The Base64url alphabet. Index in this string IS the 6-bit symbol value. */
export const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/** Thrown for any malformed, truncated or unsafe payload. */
export class ClentError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ClentError";
  }
}

/** Writes values of 1..8 bits into a Base64url string. */
export class BitWriter {
  constructor() {
    /** @type {string} */ this.out = "";
    this.acc = 0;
    this.bits = 0;
  }

  /**
   * @param {number} value
   * @param {number} width bits to write, at most 8 (keeps `acc` under 2^13)
   */
  push(value, width) {
    // Encode-side programmer-error guard, not attacker input: a wider write
    // would silently corrupt the accumulator, which is far worse than a throw.
    if (width > 8) throw new RangeError(`BitWriter.push width ${width} > 8`);
    this.acc = (this.acc << width) | value;
    this.bits += width;
    while (this.bits >= 6) {
      this.bits -= 6;
      this.out += B64[(this.acc >> this.bits) & 63];
    }
    this.acc &= (1 << this.bits) - 1;
  }

  /** @returns {string} the finished payload, zero-padded to a character */
  finish() {
    if (this.bits) this.out += B64[(this.acc << (6 - this.bits)) & 63];
    return this.out;
  }
}

/** Reads values of 1..8 bits back out of a Base64url string. */
export class BitReader {
  /** @param {string} str */
  constructor(str) {
    this.str = str;
    this.at = 0;
    this.acc = 0;
    this.bits = 0;
  }

  /**
   * @param {number} width bits to read, at most 8
   * @returns {number}
   */
  read(width) {
    while (this.bits < width) {
      if (this.at >= this.str.length) throw new ClentError("This link is truncated.");
      const symbol = B64_INDEX.get(this.str[this.at++]);
      if (symbol === undefined) throw new ClentError("This isn't a valid Clent link.");
      this.acc = (this.acc << 6) | symbol;
      this.bits += 6;
    }
    this.bits -= width;
    const value = (this.acc >> this.bits) & ((1 << width) - 1);
    this.acc &= (1 << this.bits) - 1;
    return value;
  }

  /** Bits not yet consumed, including whole characters not yet read. */
  get left() {
    return this.bits + 6 * (this.str.length - this.at);
  }
}

/* -------------------------------------------------------------------------- *
 * Table indexes: 3-bit head, escape into a chained byte tail
 * -------------------------------------------------------------------------- */

/**
 * The dictionary and template tables are ordered by how often their entries
 * are actually used, so an index is small far more often than not. The code
 * spends 3 bits on values 0-6; the eighth value escapes into the open-ended
 * byte chain (255 = "add 255 and keep reading"), so the tables can grow
 * forever — an appended entry costs 11 bits and up, but never a format
 * change, and links made against early indexes never notice later growth.
 */
const INDEX_HEAD = 7;

/** Bits {@link writeIndex} would spend on this index. */
export function indexBits(index) {
  if (index < INDEX_HEAD) return 3;
  let bits = 3, remaining = index - INDEX_HEAD;
  for (;;) {
    bits += 8;
    if (remaining < 255) return bits;
    remaining -= 255;
  }
}

/**
 * @param {BitWriter} w
 * @param {number} index
 */
export function writeIndex(w, index) {
  if (index < INDEX_HEAD) {
    w.push(index, 3);
    return;
  }
  w.push(INDEX_HEAD, 3);
  let remaining = index - INDEX_HEAD;
  while (remaining >= 255) {
    w.push(255, 8);
    remaining -= 255;
  }
  w.push(remaining, 8);
}

/**
 * @param {BitReader} reader
 * @returns {number}
 * @throws {ClentError} when the chain runs long enough to be damage
 */
export function readIndex(reader) {
  let index = reader.read(3);
  if (index < INDEX_HEAD) return index;
  // Eight links bound the chain at over two thousand entries — far past
  // plausible table growth, cheap to refuse beyond.
  for (let hops = 0; ; hops++) {
    if (hops > 8) throw new ClentError("This link is damaged.");
    const byte = reader.read(8);
    index += byte;
    if (byte !== 255) return index;
  }
}
