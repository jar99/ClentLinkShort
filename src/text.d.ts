/** The Huffman-coded text body mode. */
import type { BitWriter, BitReader } from "./bits.js";

/** Write a body as Huffman-coded text, terminated by END. */
export declare function emitText(w: BitWriter, bytes: Uint8Array): void;

/** Read a text body back, stopping at END. @throws {ClentError} */
export declare function decodeText(reader: BitReader): string;

/** The bits emitText would write, without writing them. */
export declare function textBits(bytes: Uint8Array): number;
