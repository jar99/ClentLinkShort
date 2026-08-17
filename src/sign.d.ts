/** Integrity checks and passphrase signatures for payloads. */

/** Marker for a keyless integrity check. */
export declare const TAG_CHECK: "c";
/** Marker for a passphrase signature. */
export declare const TAG_SIGNED: "h";

/** Whether this runtime can hash. Without it, tags cannot be made or checked. */
export declare const canSign: boolean;

/** Truncated SHA-256 of the payload. Catches accidents, not attackers. */
export declare function checksum(payload: string, chars?: number): Promise<string>;

/** Truncated HMAC-SHA-256 under a passphrase. @throws {ClentError} without one. */
export declare function sign(payload: string, passphrase: string, chars?: number): Promise<string>;

export interface SplitFragment {
  payload: string;
  kind: string | null;
  tag: string;
}

/** Split a fragment into its payload and tag. */
export declare function split(fragment: string): SplitFragment;

/** Join a payload with a tag: `<payload>.<kind><tag>`. */
export declare const join: (payload: string, kind: string, tag: string) => string;

/** Check a tag against a payload. */
export declare function verify(
  payload: string,
  kind: string,
  tag: string,
  passphrase?: string,
): Promise<{ ok: boolean; reason?: string }>;
