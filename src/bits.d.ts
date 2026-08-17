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

/**
 * Table indexes: 3 bits for values 0-6, the eighth value escaping into an
 * open-ended chained byte tail, so frequency-ordered tables grow forever.
 */

/** Bits {@link writeIndex} would spend on this index. */
export declare function indexBits(index: number): number;

/** Write an escape-coded table index. */
export declare function writeIndex(w: BitWriter, index: number): void;

/** Read an escape-coded table index back. @throws {ClentError} on a runaway chain */
export declare function readIndex(reader: BitReader): number;
