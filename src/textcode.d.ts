/** Mined text-mode tables: canonical Huffman lengths, tokens as symbols. */

/** Code length per symbol; 256 END, 257 ESC, 258+k = token k. 0 = uncoded. */
export declare const CODE_LENGTHS: readonly number[];

export declare const SYM_END: 256;
export declare const SYM_ESC: 257;
/** First token symbol; token k lives at TOKEN_BASE + k. */
export declare const TOKEN_BASE: 258;

/** The substring dictionary, indexed as on the wire. */
export declare const TOKENS: readonly string[];
