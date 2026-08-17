/** The host field: a hostname in its own suffix-terminal Huffman code. */
import type { BitWriter, BitReader } from "./bits.js";

/** The bits emitHost would write, without writing them. */
export declare function hostBits(host: string): number;

/** Write a host field: name characters, then a suffix terminal or END. */
export declare function emitHost(w: BitWriter, host: string): void;

/** Read a host field back. @throws {ClentError} */
export declare function decodeHost(reader: BitReader): string;
