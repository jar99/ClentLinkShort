/**
 * Clent — a stateless URL codec.
 *
 * Packs a URL into a short, URL-safe string containing the whole destination,
 * so nothing needs to be stored anywhere to resolve it back.
 *
 * This is the public API; the focused modules are re-exported here so callers
 * need one import.
 */

export { B64, BitWriter, BitReader, ClentError } from "./bits.js";
export { canCompress, deflate, inflate, MAX_INFLATED } from "./deflate.js";
export { emitText, decodeText, textBits } from "./text.js";
export { TRACKING_PARAMS, TRACKING_BY_HOST, stripTracking } from "./tracking.js";
export { RISK_NONE, RISK_NOTE, RISK_BLOCK, assess } from "./risk.js";
export { HOSTS } from "./hosts.js";
export { TOKENS } from "./textcode.js";
export { TEMPLATES } from "./templates.js";
export {
  ENCODABLE_ORDER, SCHEME_BITS, SCHEME_IN_BODY, ENCODABLE, FOLLOWABLE,
} from "./schemes.js";

/** Wire format version this build reads and writes. */
export declare const VERSION: 7;

export declare const SCHEME_HTTPS: 0;
export declare const SCHEME_HTTP: 1;
export declare const SCHEME_OTHER: 2;
export declare const SCHEME_TEMPLATE: 3;
/** @deprecated v5 name for SCHEME_OTHER. */
export declare const SCHEME_VERBATIM: 2;

export declare const MODE_TEXT: 0;
/** @deprecated v6 name for MODE_TEXT. */
export declare const MODE_TEXT6: 0;
export declare const MODE_RAW: 1;
export declare const MODE_DEFLATE: 2;
/** Analysis-level marker for a template win; never a wire value. */
export declare const MODE_TEMPLATE: 3;

export type Mode = 0 | 1 | 2 | 3;
export type ModeName = "text" | "raw" | "deflate" | "template";

/** Human-readable mode names, indexed by mode. */
export declare const MODE_NAMES: readonly ModeName[];

/** Header bit: "www." was stripped from the host. */
export declare const F_WWW: 4;
/** Header bit: the host is a dictionary index. */
export declare const F_HOST: 8;

/** Longest URL the codec will encode or return. */
export declare const MAX_URL: 8192;
/** Longest payload expand() will read. */
export declare const MAX_PAYLOAD: 16384;

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
  /** Winning mode. */
  mode: Mode;
  /** Winning mode, named. */
  modeName: ModeName;
  /** Tracking parameters that were dropped. */
  removed: string[];
  /** Host as stored; null when the URL went through the "other" scheme. */
  host: string | null;
  /** Dictionary index, or null when the host is spelled out. */
  hostByte: number | null;
  /** Winning template index, or null. */
  template: number | null;
  /** Winning template's pattern, or null. */
  templatePattern: string | null;
  /** Bits spent on the header, scheme index and host index. */
  headerBits: number;
  /** Bits spent on the body. */
  bodyBits: number;
  /** Best payload length per mode; null where a mode was unavailable. */
  candidates: {
    text: number | null;
    raw: number | null;
    deflate: number | null;
    template: number | null;
  };
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
 * The result is guaranteed to have a scheme in ENCODABLE; callers that
 * navigate automatically must additionally check {@link isFollowable}.
 *
 * @throws {ClentError} with a message safe to show a user.
 */
export declare function expand(payload: string): Promise<URL>;

/** Whether a decoded URL may be navigated to without a human clicking first. */
export declare function isFollowable(url: URL): boolean;

/** Parse user input into a URL, tolerating a missing scheme. @throws {ClentError} */
export declare function parse(input: string): URL;

/**
 * Assemble one complete candidate payload. Exposed for tests and the
 * optimality oracle. schemeIndex is required exactly when flags carry
 * SCHEME_OTHER.
 */
export declare function build(
  flags: number,
  mode: Mode,
  hostByte: number | null,
  bytes: Uint8Array,
  schemeIndex?: number | null,
): string;
