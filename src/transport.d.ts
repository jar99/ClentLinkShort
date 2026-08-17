/**
 * Transport encodings: Base64url (canonical), dense ASCII (6.44 bits a
 * character) and emoji (8 bits a glyph).
 */

/** Is this fragment payload wearing the dense transport? */
export declare function isDense(payload: string): boolean;

/** Re-dress a canonical Base64url payload in the dense alphabet. */
export declare function toDense(payload: string): string;

/** Undress a dense payload back to canonical Base64url. @throws {ClentError} */
export declare function fromDense(payload: string): string;

/** Is this fragment payload wearing the emoji transport? */
export declare function isEmoji(payload: string): boolean;

/** Re-dress a canonical Base64url payload as emoji. */
export declare function toEmoji(payload: string): string;

/** Undress an emoji payload back to canonical Base64url. @throws {ClentError} */
export declare function fromEmoji(payload: string): string;

/** Detect the transport and return the canonical Base64url payload. */
export declare function decodeTransport(payload: string): string;
