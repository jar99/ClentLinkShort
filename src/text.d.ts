/** The Huffman-coded text body mode. */
import type { BitWriter, BitReader } from "./bits.js";

/** Bits the terminating END symbol costs; part of every body's price. */
export declare const END_BITS: number;

export interface TextPlan {
  /** cost[i] = bits to write bytes[i..] (END excluded) */
  cost: Int32Array;
  /** -1 = literal at i, else the token index to emit */
  choice: Int32Array;
}

/**
 * The token-or-literal plan for a body. Computed backwards, so it is also
 * the plan for every suffix of the body.
 */
export declare function planText(bytes: Uint8Array): TextPlan;

/**
 * Write a body as Huffman-coded text, terminated by END. With `plan` and
 * `from`, writes the suffix of an already-planned longer body.
 */
export declare function emitText(
  w: BitWriter,
  bytes: Uint8Array,
  plan?: TextPlan,
  from?: number,
): void;

/** Read a text body back, stopping at END. @throws {ClentError} */
export declare function decodeText(reader: BitReader): string;

/** The bits emitText would write, without writing them. */
export declare function textBits(bytes: Uint8Array): number;
