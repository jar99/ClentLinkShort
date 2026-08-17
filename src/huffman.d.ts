/** Canonical Huffman machinery shared by the text and host codes. */
import type { BitWriter, BitReader } from "./bits.js";

/** Longest code either shipped table uses. */
export declare const MAX_CODE_LEN: 15;

export interface Code {
  /** code value per symbol (-1 = not coded) */
  code: Int32Array;
  /** code length per symbol (0 = not coded) */
  len: Uint8Array;
  /** symbols in canonical order */
  ordered: number[];
  /** first code value per length */
  firstCode: Int32Array;
  /** first `ordered` index per length */
  firstIndex: Int32Array;
}

/** Build the canonical code for a lengths array. */
export declare function buildCode(lengths: readonly number[]): Code;

/** Write one symbol's canonical code. */
export declare function pushCode(w: BitWriter, table: Code, symbol: number): void;

/** Read one canonical symbol. @throws {ClentError} */
export declare function readSymbol(reader: BitReader, table: Code): number;
