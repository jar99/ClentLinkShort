/**
 * Clent — a stateless URL codec.
 *
 * Packs a URL into a short, URL-safe string containing the whole destination,
 * so nothing needs to be stored anywhere to resolve it back.
 */

/** Wire format version this build reads and writes. */
export declare const VERSION: 2;

export declare const SCHEME_HTTPS: 0;
export declare const SCHEME_HTTP: 1;
export declare const SCHEME_VERBATIM: 2;

export declare const MODE_TEXT6: 0;
export declare const MODE_RAW: 1;
export declare const MODE_DEFLATE: 2;

export type Mode = 0 | 1 | 2;
export type ModeName = "text6" | "raw" | "deflate";

/** Human-readable body mode names, indexed by mode. */
export declare const MODE_NAMES: readonly ModeName[];

/** The host dictionary. Append-only: an entry's index is its wire encoding. */
export declare const HOSTS: readonly string[];

/** Schemes that may be encoded into a link at all. */
export declare const ENCODABLE: ReadonlySet<string>;

/** Schemes a redirector may navigate to without a human clicking first. */
export declare const FOLLOWABLE: ReadonlySet<string>;

/** Query parameters removed when tracking-stripping is enabled. */
export declare const TRACKING_PARAMS: RegExp;

/** The Base64url alphabet; an index in this string is a 6-bit symbol value. */
export declare const B64: string;

/** The text6 symbol table; symbols 0..60 are literal bytes. */
export declare const T6: string;

/** Whether this runtime can DEFLATE. Without it, links are merely longer. */
export declare const canCompress: boolean;

/** Thrown for any malformed, truncated or unsafe payload. */
export declare class ClentError extends Error {
  readonly name: "ClentError";
}

export interface ShortenOptions {
  /** Remove utm_*, fbclid, gclid and friends. Defaults to true. */
  stripTracking?: boolean;
}

/** Everything the encoder decided, for callers that want to show their work. */
export interface Analysis {
  /** The winning payload. */
  payload: string;
  /** The URL as it will be reconstructed. */
  url: URL;
  /** Winning body mode. */
  mode: Mode;
  /** Winning body mode, named. */
  modeName: ModeName;
  /** Tracking parameters that were dropped. */
  removed: string[];
  /** Host as stored, before dictionary lookup; null when stored verbatim. */
  host: string | null;
  /** Dictionary index, or null when the host is spelled out. */
  hostByte: number | null;
  /** Bits spent on the header and host index. */
  headerBits: number;
  /** Bits spent on the body. */
  bodyBits: number;
  /** Payload length per mode; deflate is null where unsupported. */
  candidates: { text6: number; raw: number; deflate: number | null };
}

/**
 * Pack a URL into a payload string, safe to drop into a fragment as-is.
 * @throws {ClentError} on unparseable input or a scheme outside ENCODABLE.
 */
export declare function shorten(
  input: string | URL,
  options?: ShortenOptions,
): Promise<string>;

/** Like {@link shorten}, but reports every decision the encoder made. */
export declare function analyze(
  input: string | URL,
  options?: ShortenOptions,
): Promise<Analysis>;

/**
 * Unpack a payload back into its URL.
 *
 * The result is guaranteed to have a scheme in {@link ENCODABLE}; callers that
 * navigate automatically must additionally check {@link isFollowable}.
 *
 * @throws {ClentError} with a message safe to show a user.
 */
export declare function expand(payload: string): Promise<URL>;

/** Whether a decoded URL may be navigated to without a human clicking first. */
export declare function isFollowable(url: URL): boolean;

/** Parse user input into a URL, tolerating a missing scheme. */
export declare function parse(input: string): URL;

/** Remove known tracking parameters in place; returns the names removed. */
export declare function stripTracking(url: URL): string[];

/** Compress; resolves null where the runtime cannot DEFLATE. */
export declare function deflate(bytes: Uint8Array): Promise<Uint8Array | null>;

/** Decompress. @throws {ClentError} */
export declare function inflate(bytes: Uint8Array): Promise<Uint8Array>;

/** Assemble one complete candidate payload. Exposed for tests. */
export declare function build(
  flags: number,
  mode: Mode,
  hostByte: number | null,
  bytes: Uint8Array,
): string;

/** Writes values of 1..8 bits into a Base64url string. */
export declare class BitWriter {
  out: string;
  push(value: number, width: number): void;
  finish(): string;
}

/** Reads values of 1..8 bits back out of a Base64url string. */
export declare class BitReader {
  constructor(str: string);
  read(width: number): number;
  /** Bits not yet consumed, including whole characters not yet read. */
  readonly left: number;
}
