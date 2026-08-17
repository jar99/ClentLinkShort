/** Mined text-mode tables: canonical Huffman lengths and the token dictionary. */

/** Code length per symbol; index 256 TOKEN, 257 END, 258 ESC. 0 = uncoded. */
export declare const CODE_LENGTHS: readonly number[];

export declare const SYM_TOKEN: 256;
export declare const SYM_END: 257;
export declare const SYM_ESC: 258;

/** Width of a token index after the TOKEN symbol. */
export declare const TOKEN_INDEX_BITS: number;

/** The substring dictionary, indexed as on the wire. */
export declare const TOKENS: readonly string[];
