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
