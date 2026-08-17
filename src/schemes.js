/**
 * The scheme table: every scheme the codec will encode, in wire order.
 *
 * Under scheme code 2 ("other") the header is followed by a 4-bit index into
 * this list, so `mailto:` costs 4 bits instead of being spelled out as seven
 * characters in the body — the change that makes non-http links first-class.
 *
 * APPEND-ONLY, and at most 15 entries: the index is 4 bits and value 15 is
 * reserved forever to mean "the scheme is spelled inside the body", so a
 * future decoder can carry schemes this table has never heard of. http and
 * https are pinned at 0 and 1 — the header's own scheme codes mirror them.
 *
 * Table format for wire v6.
 *
 * @module schemes
 */

/** @type {readonly string[]} */
export const ENCODABLE_ORDER = Object.freeze([
  "http:", "https:", "mailto:", "ftp:", "ftps:", "tel:", "sms:",
  "magnet:", "ipfs:", "ipns:",
]);

/** @type {ReadonlyMap<string, number>} */
export const SCHEME_INDEX = new Map(ENCODABLE_ORDER.map((s, i) => [s, i]));

/** Width of the scheme index under scheme code 2. */
export const SCHEME_BITS = 4;

/** Reserved index: the scheme is spelled inside the body, not looked up. */
export const SCHEME_IN_BODY = 15;

/**
 * Schemes that may be encoded into a link at all. Everything outside this
 * set is refused on the way in and on the way out, which is what stops a
 * hand-crafted payload from turning a redirector into an XSS vector.
 * @type {ReadonlySet<string>}
 */
export const ENCODABLE = new Set(ENCODABLE_ORDER);

/**
 * Schemes a redirector may navigate to automatically. Deliberately much
 * narrower than ENCODABLE: anything else has to be clicked by a human.
 * @type {ReadonlySet<string>}
 */
export const FOLLOWABLE = new Set(["http:", "https:"]);
