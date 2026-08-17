/** The 6-bit text body encoding with its token dictionary. */
import type { BitWriter, BitReader } from "./bits.js";

/** The text6 symbol table; symbols 0..58 are literal bytes. */
export declare const T6: string;

/** Write a body as text6, choosing tokens by dynamic programming. */
export declare function emitText6(w: BitWriter, bytes: Uint8Array): void;

/** Read a text6 body back, stopping at END. @throws {ClentError} */
export declare function decodeText6(reader: BitReader): string;
