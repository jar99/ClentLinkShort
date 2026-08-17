/**
 * Clent — a stateless URL codec.
 *
 * Packs a URL into a short, URL-safe string that contains the whole
 * destination, so no storage is needed anywhere to resolve it back.
 *
 * Zero dependencies. Runs unmodified in browsers and in Node >= 18.
 *
 * ---------------------------------------------------------------------------
 * Wire format v2
 *
 * A continuous bit stream written straight into the Base64url alphabet at
 * 6 bits per character. Nothing rounds up to a byte, so nothing is wasted.
 *
 *   6 bits  header  bits 0-1  scheme: 0 https://, 1 http://, 2 verbatim
 *                   bit  2    "www." was stripped from the host
 *                   bit  3    host came from the dictionary
 *                   bits 4-5  body mode: 0 text6, 1 raw, 2 deflate
 *   8 bits  host dictionary index, present only when bit 3 is set
 *   body    text6   6-bit symbols, terminated by END
 *           raw     UTF-8 bytes, 8 bits each
 *           deflate DEFLATE-raw bytes, 8 bits each
 *
 * All body modes are built and the shortest is kept, so the codec never
 * loses to itself. text6 wins on ordinary lowercase URLs (one output
 * character per input character — Base64 is also 6 bits, so packing text at
 * 6 bits costs nothing), raw wins on mixed-case ID tokens, and deflate wins
 * once a URL is long enough to repay its overhead.
 * ---------------------------------------------------------------------------
 *
 * @module clent
 */

import { HOSTS, HOST_INDEX } from "./hosts.js";

export { HOSTS };

/** Wire format version this build reads and writes. */
export const VERSION = 2;

export const SCHEME_HTTPS = 0, SCHEME_HTTP = 1, SCHEME_VERBATIM = 2;
export const MODE_TEXT6 = 0, MODE_RAW = 1, MODE_DEFLATE = 2;

/** @type {readonly string[]} Human-readable body mode names, indexed by mode. */
export const MODE_NAMES = Object.freeze(["text6", "raw", "deflate"]);

const SCHEME_MASK = 0b11, F_WWW = 0b100, F_HOST = 0b1000;

/**
 * Schemes that may be encoded into a link at all. Everything outside this
 * set is refused on the way in and on the way out, which is what stops a
 * hand-crafted payload from turning a redirector into an XSS vector.
 * @type {ReadonlySet<string>}
 */
export const ENCODABLE = new Set([
  "http:", "https:", "mailto:", "ftp:", "ftps:", "tel:", "sms:",
  "magnet:", "ipfs:", "ipns:",
]);

/**
 * Schemes a redirector may navigate to automatically. Deliberately much
 * narrower than ENCODABLE: anything else has to be clicked by a human.
 * @type {ReadonlySet<string>}
 */
export const FOLLOWABLE = new Set(["http:", "https:"]);

/**
 * Query parameters removed when `stripTracking` is enabled. This is the only
 * transformation in the codec that changes the destination rather than just
 * re-encoding it, which is why it is opt-out and reported separately.
 */
export const TRACKING_PARAMS =
  /^(?:utm_[\w-]*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|ttclid|twclid|igshid|epik|irclickid|mc_[ce]id|_hsenc|_hsmi|hsa_[\w-]+|_ga|_gl|ref_src|ref_url|s_kwcid|ef_id|oly_(?:enc|anon)_id|vero_id|piwik_[\w-]+|pk_[\w-]+|at_[\w-]+|si|spm|scm|share_source|__s)$/i;

/* -------------------------------------------------------------------------- *
 * Bit stream
 * -------------------------------------------------------------------------- */

/** The Base64url alphabet. Index in this string IS the 6-bit symbol value. */
export const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/**
 * text6 symbol table. Symbols 0..60 are literal bytes; the three control
 * symbols below cover everything else.
 */
export const T6 = "abcdefghijklmnopqrstuvwxyz0123456789/-_.?=&%+,:~#@!$*();'[]";
const T6_INDEX = new Map([...T6].map((c, i) => [c.charCodeAt(0), i]));

/** Uppercase the next symbol. */
const SHIFT = 61;
/** One raw 8-bit byte follows. */
const ESC = 62;
/** End of body. */
const END = 63;

/** Thrown for any malformed, truncated or unsafe payload. */
export class ClentError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ClentError";
  }
}

/** Writes values of 1..8 bits into a Base64url string. */
export class BitWriter {
  constructor() {
    /** @type {string} */ this.out = "";
    this.acc = 0;
    this.bits = 0;
  }

  /**
   * @param {number} value
   * @param {number} width bits to write, at most 8 (keeps `acc` under 2^13)
   */
  push(value, width) {
    this.acc = (this.acc << width) | value;
    this.bits += width;
    while (this.bits >= 6) {
      this.bits -= 6;
      this.out += B64[(this.acc >> this.bits) & 63];
    }
    this.acc &= (1 << this.bits) - 1;
  }

  /** @returns {string} the finished payload, zero-padded to a character */
  finish() {
    if (this.bits) this.out += B64[(this.acc << (6 - this.bits)) & 63];
    return this.out;
  }
}

/** Reads values of 1..8 bits back out of a Base64url string. */
export class BitReader {
  /** @param {string} str */
  constructor(str) {
    this.str = str;
    this.at = 0;
    this.acc = 0;
    this.bits = 0;
  }

  /**
   * @param {number} width bits to read, at most 8
   * @returns {number}
   */
  read(width) {
    while (this.bits < width) {
      if (this.at >= this.str.length) throw new ClentError("This link is truncated.");
      const symbol = B64_INDEX.get(this.str[this.at++]);
      if (symbol === undefined) throw new ClentError("This isn't a valid Clent link.");
      this.acc = (this.acc << 6) | symbol;
      this.bits += 6;
    }
    this.bits -= width;
    const value = (this.acc >> this.bits) & ((1 << width) - 1);
    this.acc &= (1 << this.bits) - 1;
    return value;
  }

  /** Bits not yet consumed, including whole characters not yet read. */
  get left() {
    return this.bits + 6 * (this.str.length - this.at);
  }
}

/* -------------------------------------------------------------------------- *
 * DEFLATE
 * -------------------------------------------------------------------------- */

/** Whether this runtime can compress. Without it links are simply longer. */
export const canCompress = typeof CompressionStream !== "undefined";

/**
 * @param {typeof CompressionStream | typeof DecompressionStream} Ctor
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
async function runStream(Ctor, bytes) {
  const stream = new Ctor("deflate-raw");
  const writer = stream.writable.getWriter();
  // Corrupt input rejects on the writable side as well as the readable one.
  // Keep a handle on it so it surfaces here instead of as an unhandled
  // rejection, but don't let it reject before the read below observes it.
  const pump = writer.write(bytes).then(() => writer.close());
  pump.catch(() => {});
  const out = new Uint8Array(await new Response(stream.readable).arrayBuffer());
  await pump;
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array|null>} null where the runtime can't compress
 */
export async function deflate(bytes) {
  if (!canCompress) return null;
  try {
    return await runStream(CompressionStream, bytes);
  } catch {
    return null; // engines that have CompressionStream but not "deflate-raw"
  }
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined")
    throw new ClentError("This browser can't decompress the link (needs DecompressionStream).");
  try {
    return await runStream(DecompressionStream, bytes);
  } catch {
    throw new ClentError("This link is damaged — decompression failed.");
  }
}

/* -------------------------------------------------------------------------- *
 * Canonicalisation
 * -------------------------------------------------------------------------- */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Remove known tracking parameters in place.
 * @param {URL} url
 * @returns {string[]} the parameter names removed
 */
export function stripTracking(url) {
  const hits = [...url.searchParams.keys()].filter((k) => TRACKING_PARAMS.test(k));
  for (const key of hits) url.searchParams.delete(key);
  // Re-serialising an emptied query leaves a bare "?" behind.
  if (![...url.searchParams].length) url.search = "";
  return hits;
}

/**
 * Parse user input into a URL, tolerating a missing scheme.
 * @param {string} input
 * @returns {URL}
 * @throws {ClentError}
 */
export function parse(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) throw new ClentError("Paste a URL first.");
  // "example.com/x" is what people actually paste.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : "https://" + trimmed;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    throw new ClentError("That doesn't parse as a URL.");
  }
  if (!ENCODABLE.has(url.protocol))
    throw new ClentError(`Refusing to encode a "${url.protocol}" link.`);
  if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname)
    throw new ClentError("That URL has no host.");
  return url;
}

/**
 * Split a parsed URL into the pieces the wire format stores.
 * @param {URL} url
 * @returns {{flags: number, hostByte: number|null, body: string, host: string|null}}
 */
function canonicalise(url) {
  // The compact form has nowhere to keep userinfo, and silently dropping it
  // would repoint the link — so those go verbatim.
  const compact =
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username && !url.password;

  if (!compact) {
    return { flags: SCHEME_VERBATIM, hostByte: null, body: url.href, host: null };
  }

  let flags = url.protocol === "http:" ? SCHEME_HTTP : SCHEME_HTTPS;
  let host = url.host; // includes a non-default port

  // "www." is worth a bit, but not when the dictionary already has the full host.
  if (host.startsWith("www.") && !HOST_INDEX.has(host)) {
    host = host.slice(4);
    flags |= F_WWW;
  }

  // Sliced out of href rather than assembled from pathname + search + hash:
  // those drop a trailing empty "?" or "#", which changes the destination.
  let tail = url.href.slice(url.origin.length);
  if (tail === "/") tail = ""; // implied on the way back

  const index = HOST_INDEX.get(host);
  if (index !== undefined) {
    return { flags: flags | F_HOST, hostByte: index, body: tail, host };
  }
  return { flags, hostByte: null, body: host + tail, host };
}

/* -------------------------------------------------------------------------- *
 * Encoding
 * -------------------------------------------------------------------------- */

/**
 * Assemble one complete candidate payload. Called once per body mode.
 * @param {number} flags
 * @param {number} mode
 * @param {number|null} hostByte
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function build(flags, mode, hostByte, bytes) {
  const w = new BitWriter();
  w.push(flags | (mode << 4), 6);
  if (hostByte !== null) w.push(hostByte, 8);

  if (mode === MODE_TEXT6) {
    for (const byte of bytes) {
      const direct = T6_INDEX.get(byte);
      if (direct !== undefined) {
        w.push(direct, 6);
        continue;
      }
      const upper = byte >= 65 && byte <= 90 ? T6_INDEX.get(byte + 32) : undefined;
      if (upper !== undefined) {
        w.push(SHIFT, 6);
        w.push(upper, 6);
      } else {
        w.push(ESC, 6);
        w.push(byte, 8);
      }
    }
    w.push(END, 6);
  } else {
    for (const byte of bytes) w.push(byte, 8);
  }
  return w.finish();
}

/**
 * @typedef {object} ShortenOptions
 * @property {boolean} [stripTracking=true] Remove utm_*, fbclid, gclid and friends.
 */

/**
 * Pack a URL into a payload string.
 *
 * @param {string|URL} input a URL, or something close enough to one
 * @param {ShortenOptions} [options]
 * @returns {Promise<string>} Base64url payload, safe in a fragment as-is
 * @throws {ClentError} on unparseable input or a scheme outside ENCODABLE
 */
export async function shorten(input, options = {}) {
  return (await analyze(input, options)).payload;
}

/**
 * @typedef {object} Analysis
 * @property {string} payload the winning payload
 * @property {URL} url the URL as it will be reconstructed
 * @property {number} mode winning body mode
 * @property {string} modeName winning body mode, named
 * @property {string[]} removed tracking parameters that were dropped
 * @property {string|null} host host as stored, before dictionary lookup
 * @property {number|null} hostByte dictionary index, or null when spelled out
 * @property {number} headerBits bits spent on the header and host index
 * @property {number} bodyBits bits spent on the body
 * @property {Record<string, number|null>} candidates payload length per mode
 *
 * Everything the encoder decided, for callers that want to show their work.
 * `shorten` is this with only `payload` kept.
 *
 * @param {string|URL} input
 * @param {ShortenOptions} [options]
 * @returns {Promise<Analysis>}
 */
export async function analyze(input, options = {}) {
  const { stripTracking: clean = true } = options;
  // A URL instance goes through parse() too — it is the only scheme check.
  const url = parse(input instanceof URL ? input.href : input);
  const removed = clean && (url.protocol === "http:" || url.protocol === "https:")
    ? stripTracking(url)
    : [];

  const { flags, hostByte, body, host } = canonicalise(url);
  const bytes = encoder.encode(body);
  const zipped = await deflate(bytes);

  /** @type {Record<number, string>} */
  const built = {
    [MODE_TEXT6]: build(flags, MODE_TEXT6, hostByte, bytes),
    [MODE_RAW]: build(flags, MODE_RAW, hostByte, bytes),
  };
  if (zipped) built[MODE_DEFLATE] = build(flags, MODE_DEFLATE, hostByte, zipped);

  let mode = MODE_TEXT6;
  for (const key of Object.keys(built).map(Number)) {
    if (built[key].length < built[mode].length) mode = key;
  }

  const headerBits = 6 + (hostByte === null ? 0 : 8);
  return {
    payload: built[mode],
    url,
    mode,
    modeName: MODE_NAMES[mode],
    removed,
    host,
    hostByte,
    headerBits,
    bodyBits: built[mode].length * 6 - headerBits,
    candidates: {
      text6: built[MODE_TEXT6].length,
      raw: built[MODE_RAW].length,
      deflate: zipped ? built[MODE_DEFLATE].length : null,
    },
  };
}

/* -------------------------------------------------------------------------- *
 * Decoding
 * -------------------------------------------------------------------------- */

/**
 * Unpack a payload back into its URL.
 *
 * Every failure path throws {@link ClentError} with a message safe to show a
 * user. The returned URL is guaranteed to have a scheme in {@link ENCODABLE};
 * callers that navigate automatically must additionally check
 * {@link FOLLOWABLE}.
 *
 * @param {string} payload
 * @returns {Promise<URL>}
 * @throws {ClentError}
 */
export async function expand(payload) {
  const code = String(payload ?? "");
  if (!code) throw new ClentError("This link is empty.");
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ClentError("This isn't a valid Clent link.");

  const reader = new BitReader(code);
  const header = reader.read(6);
  const flags = header & 0b1111;
  const mode = (header >> 4) & 0b11;
  const hostIndex = flags & F_HOST ? reader.read(8) : null;

  let body;
  if (mode === MODE_TEXT6) {
    /** @type {number[]} */
    const bytes = [];
    let shifted = false;
    for (;;) {
      if (reader.left < 6) throw new ClentError("This link is truncated.");
      const symbol = reader.read(6);
      if (symbol === END) break;
      if (symbol === SHIFT) {
        shifted = true;
        continue;
      }
      if (symbol === ESC) {
        bytes.push(reader.read(8));
        shifted = false;
        continue;
      }
      const ch = T6.charCodeAt(symbol);
      bytes.push(shifted && ch >= 97 && ch <= 122 ? ch - 32 : ch);
      shifted = false;
    }
    body = decoder.decode(new Uint8Array(bytes));
  } else if (mode === MODE_RAW || mode === MODE_DEFLATE) {
    const count = Math.floor(reader.left / 8); // trailing padding is under 8 bits
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i++) bytes[i] = reader.read(8);
    body = decoder.decode(mode === MODE_DEFLATE ? await inflate(bytes) : bytes);
  } else {
    throw new ClentError("This link uses an unknown format.");
  }

  const scheme = flags & SCHEME_MASK;
  let href;
  if (scheme === SCHEME_VERBATIM) {
    href = body;
  } else if (scheme === SCHEME_HTTPS || scheme === SCHEME_HTTP) {
    let host, tail;
    if (hostIndex !== null) {
      host = HOSTS[hostIndex];
      if (host === undefined)
        throw new ClentError("This link uses a newer host dictionary than this page has.");
      tail = body;
    } else {
      host = body.match(/^[^/?#]*/)[0];
      tail = body.slice(host.length);
    }
    if (flags & F_WWW) host = "www." + host;
    if (!host) throw new ClentError("This link is damaged — no host.");
    href = (scheme === SCHEME_HTTP ? "http://" : "https://") + host + tail;
  } else {
    throw new ClentError("This link uses an unknown format.");
  }

  let url;
  try {
    url = new URL(href);
  } catch {
    throw new ClentError("This link decoded to something that isn't a URL.");
  }
  if (!ENCODABLE.has(url.protocol))
    throw new ClentError(`Refusing to open a "${url.protocol}" link.`);
  return url;
}

/**
 * Whether a decoded URL may be navigated to without a human clicking first.
 * @param {URL} url
 * @returns {boolean}
 */
export function isFollowable(url) {
  return FOLLOWABLE.has(url.protocol);
}
