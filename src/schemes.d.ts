/** The scheme table. Append-only; at most 15 entries, http/https pinned. */

export declare const ENCODABLE_ORDER: readonly string[];
export declare const SCHEME_INDEX: ReadonlyMap<string, number>;

/** Width of the scheme index under scheme code 2. */
export declare const SCHEME_BITS: 4;

/** Reserved index: the scheme is spelled inside the body. */
export declare const SCHEME_IN_BODY: 15;

/** Schemes that may be encoded into a link at all. */
export declare const ENCODABLE: ReadonlySet<string>;

/** Schemes a redirector may navigate to without a human clicking first. */
export declare const FOLLOWABLE: ReadonlySet<string>;
