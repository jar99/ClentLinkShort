/** Mined host-code tables: canonical Huffman lengths and the suffix table. */

/** Code length per symbol; 256 END, 257 ESC, 258+k suffix terminals. 0 = uncoded. */
export declare const HOST_CODE_LENGTHS: readonly number[];

export declare const HOST_END: 256;
export declare const HOST_ESC: 257;
export declare const SUFFIX_BASE: 258;

/** Suffix per terminal symbol, longest first. */
export declare const SUFFIXES: readonly string[];
