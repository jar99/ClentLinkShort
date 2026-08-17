/** The bit stream and the codec's error type. */

/** The Base64url alphabet; an index in this string is a 6-bit symbol value. */
export declare const B64: string;

/** Thrown for any malformed, truncated or unsafe payload. */
export declare class ClentError extends Error {
  readonly name: "ClentError";
  constructor(message: string);
}

/** Writes values of 1..8 bits into a Base64url string. */
export declare class BitWriter {
  out: string;
  /** @throws {RangeError} when width exceeds 8 */
  push(value: number, width: number): void;
  finish(): string;
}

/** Reads values of 1..8 bits back out of a Base64url string. */
export declare class BitReader {
  constructor(str: string);
  read(width: number): number;
  /** Bits not yet consumed, including whole characters not yet read. */
  readonly left: number;
}
