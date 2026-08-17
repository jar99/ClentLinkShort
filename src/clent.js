/**
 * Clent — a stateless URL codec.
 *
 * Packs a URL into a short, URL-safe string that contains the whole
 * destination, so no storage is needed anywhere to resolve it back.
 *
 * Zero dependencies. Runs unmodified in browsers and in Node >= 18.
 *
 * ---------------------------------------------------------------------------
 * Wire format v4
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
 * The encoder does not decide anything by rule that it could decide by
 * measurement. Every legal way of splitting the URL is crossed with every
 * body mode, and the smallest result wins. text6 wins on ordinary lowercase
 * URLs (one output character per input character — Base64 is also 6 bits, so
 * packing text at 6 bits costs nothing), raw wins on uppercase-dense ID
 * tokens, and deflate wins once a URL is long enough to repay its overhead.
 * ---------------------------------------------------------------------------
 *
 * @module clent
 */

import { HOSTS, HOST_INDEX } from "./hosts.js";
import { TOKENS } from "./tokens.js";

export { HOSTS, TOKENS };

/** Wire format version this build reads and writes. */
export const VERSION = 4;

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
 * Query parameters removed when `stripTracking` is enabled.
 *
 * This is the only transformation in the codec that changes the destination
 * rather than re-encoding it, which is why it is a visible switch and is
 * reported separately.
 *
 * The list errs towards leaving things alone. Anything that might select
 * what you actually see is not here: Amazon's `th` and `psc` pick a product
 * variant, and a bare `ref` is a real route parameter on plenty of sites even
 * though Amazon uses it for tracking. Affiliate tags (`tag`, `campid`,
 * `ascsubtag`) *are* removed — they are tracking identifiers, and the switch
 * is there for anyone who is deliberately sharing their own.
 */
export const TRACKING_PARAMS = new RegExp("^(?:" + [
  // analytics and ad networks
  "utm_[\\w-]*", "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid",
  "yclid", "ttclid", "twclid", "epik", "irclickid", "mc_[ce]id", "_hsenc",
  "_hsmi", "hsa_[\\w-]+", "_ga", "_gl", "s_kwcid", "ef_id", "vero_id",
  "oly_(?:enc|anon)_id", "piwik_[\\w-]+", "pk_[\\w-]+", "at_[\\w-]+", "__s",
  "spm", "scm", "_openstat", "yclid", "rb_clickid", "cmpid", "ncid", "sfnsn",
  // social
  "igshid", "igsh", "share_source", "share_app_id", "share_id", "ref_src",
  "ref_url", "rdt", "si", "_branch_match_id", "_branch_referrer", "xmt",
  "is_from_webapp", "sender_device", "web_id", "social_share", "smid",
  // video
  "pp", "ab_channel",
  // shopping and marketplaces
  "pd_rd_[\\w-]+", "pf_rd_[\\w-]+", "linkCode", "linkId", "ascsubtag", "tag",
  "creativeASIN", "creative", "camp", "qid", "sr", "sprefix", "crid",
  "content-id", "dib", "dib_tag", "_trkparms", "_trksid", "campid",
  "customid", "toolid", "mkevt", "mkcid", "mkrid", "click_key", "click_sum",
  "frs", "sts", "organic_search_click", "athbdg", "adsRedirect", "veh",
  "irgwc", "sourceid", "affid", "afsrc", "srsltid",
].join("|") + ")$", "i");

/**
 * Parameters that are only safe to remove on particular hosts.
 *
 * `s` and `t` are how X marks a shared link, and `trk` is LinkedIn's — but
 * one-letter and three-letter names like those are ordinary search or state
 * parameters everywhere else, so removing them globally would quietly break
 * links. Scoping them keeps the aggressive removal without the collateral.
 *
 * @type {ReadonlyArray<{host: RegExp, params: RegExp}>}
 */
export const TRACKING_BY_HOST = Object.freeze([
  { host: /(?:^|\.)(?:twitter|x)\.com$/i, params: /^(?:s|t)$/i },
  { host: /(?:^|\.)(?:youtube\.com|youtu\.be)$/i, params: /^(?:feature|kw|index)$/i },
  { host: /(?:^|\.)amazon\.[a-z.]+$/i, params: /^(?:ref|_encoding|smid|keywords)$/i },
  { host: /(?:^|\.)reddit\.com$/i, params: /^(?:ref|ref_source|correlation_id|share_id)$/i },
  { host: /(?:^|\.)linkedin\.com$/i, params: /^(?:trk|trackingId|originalSubdomain|lipi)$/i },
  { host: /(?:^|\.)facebook\.com$/i, params: /^(?:mibextid|extid|rdid)$/i },
  { host: /(?:^|\.)instagram\.com$/i, params: /^(?:img_index|hl)$/i },
  { host: /(?:^|\.)(?:ebay|etsy)\.[a-z.]+$/i, params: /^(?:_from|hash|var|ref)$/i },
  { host: /(?:^|\.)(?:walmart|target|bestbuy)\.com$/i, params: /^(?:from|selectedSellerId|sid)$/i },
  { host: /(?:^|\.)aliexpress\.[a-z.]+$/i, params: /^(?:sk|aff_[\w]+|terminal_id|algo_[\w]+)$/i },
]);

/* -------------------------------------------------------------------------- *
 * Bit stream
 * -------------------------------------------------------------------------- */

/** The Base64url alphabet. Index in this string IS the 6-bit symbol value. */
export const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

/**
 * text6 symbol table. Symbols 0..58 are literal bytes; the control symbols
 * below cover everything else. Symbol 60 is unassigned.
 */
export const T6 = "abcdefghijklmnopqrstuvwxyz0123456789/-_.?=&%+,:~#@!$*();'[]";
const T6_INDEX = new Map([...T6].map((c, i) => [c.charCodeAt(0), i]));

/** A 6-bit index into TOKENS follows. */
const TOKEN = 59;
/** Uppercase the next symbol. */
const SHIFT = 61;
/** One raw 8-bit byte follows. */
const ESC = 62;
/** End of body. */
const END = 63;

const tokenEncoder = new TextEncoder();
/** @type {Uint8Array[]} tokens as bytes, indexed as they are on the wire */
const TOKEN_BYTES = TOKENS.map((token) => tokenEncoder.encode(token));
/** First byte -> token indices, so matching only considers plausible tokens. */
const TOKEN_BY_FIRST = new Map();
for (let i = 0; i < TOKEN_BYTES.length; i++) {
  const first = TOKEN_BYTES[i][0];
  if (!TOKEN_BY_FIRST.has(first)) TOKEN_BY_FIRST.set(first, []);
  TOKEN_BY_FIRST.get(first).push(i);
}

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
  const scoped = TRACKING_BY_HOST
    .filter((rule) => rule.host.test(url.hostname))
    .map((rule) => rule.params);

  const hits = [...url.searchParams.keys()].filter((key) =>
    TRACKING_PARAMS.test(key) || scoped.some((params) => params.test(key)));

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
 * Every way this URL could legitimately be split for the wire format.
 *
 * More than one, because the choices interact — see the note on "www." below.
 * The encoder builds all of them and keeps the smallest result, so the choice
 * is measured rather than assumed.
 *
 * @param {URL} url
 * @returns {Array<{flags: number, hostByte: number|null, body: string, host: string|null}>}
 */
function shapesFor(url) {
  // The compact form has nowhere to keep userinfo, and silently dropping it
  // would repoint the link — so those go verbatim.
  const compact =
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username && !url.password;

  if (!compact) {
    return [{ flags: SCHEME_VERBATIM, hostByte: null, body: url.href, host: null }];
  }

  const scheme = url.protocol === "http:" ? SCHEME_HTTP : SCHEME_HTTPS;

  // Sliced out of href rather than assembled from pathname + search + hash:
  // those drop a trailing empty "?" or "#", which changes the destination.
  let tail = url.href.slice(url.origin.length);
  if (tail === "/") tail = ""; // implied on the way back

  // Both spellings of the host, where there is a choice.
  //
  // Stripping "www." looks free — four characters traded for one header bit
  // that is already paid for — and it is not. The body dictionary holds
  // entries like ".wikipedia", which match inside "www.wikipedia.org" and
  // cannot match "wikipedia.org", so stripping can cost more than it saves.
  // Rather than encode a rule about that, both are built and measured.
  const spellings = [{ host: url.host, extra: 0 }];
  if (url.host.startsWith("www.")) {
    spellings.push({ host: url.host.slice(4), extra: F_WWW });
  }

  const shapes = [];
  for (const { host, extra } of spellings) {
    const index = HOST_INDEX.get(host);
    if (index !== undefined) {
      shapes.push({ flags: scheme | extra | F_HOST, hostByte: index, body: tail, host });
    }
    shapes.push({ flags: scheme | extra, hostByte: null, body: host + tail, host });
  }
  return shapes;
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
    emitText6(w, bytes);
  } else {
    for (const byte of bytes) w.push(byte, 8);
  }
  return w.finish();
}

/** Bits to write one literal byte: direct symbol, SHIFT + symbol, or ESC + byte. */
function literalCost(byte) {
  if (T6_INDEX.has(byte)) return 6;
  if (byte >= 65 && byte <= 90 && T6_INDEX.has(byte + 32)) return 12;
  return 14;
}

/**
 * Write a body as text6, choosing tokens by dynamic programming.
 *
 * Greedy longest-match is the obvious approach and is not optimal: taking a
 * long token here can step over the start of a better one, or over a run of
 * cheap literals that would have let two tokens line up. Working backwards
 * from the end and keeping the best cost for every suffix gives the genuinely
 * smallest text6 encoding of the body, which is what the mode is then judged
 * on against raw and deflate.
 *
 * @param {BitWriter} w
 * @param {Uint8Array} bytes
 */
function emitText6(w, bytes) {
  const n = bytes.length;
  const cost = new Int32Array(n + 1);
  /** -1 = emit a literal here, otherwise the token index to emit. */
  const choice = new Int32Array(n + 1).fill(-1);

  for (let i = n - 1; i >= 0; i--) {
    let best = literalCost(bytes[i]) + cost[i + 1];
    let pick = -1;

    for (const index of TOKEN_BY_FIRST.get(bytes[i]) ?? []) {
      const token = TOKEN_BYTES[index];
      if (i + token.length > n) continue;
      let matched = true;
      for (let k = 1; k < token.length; k++) {
        if (bytes[i + k] !== token[k]) {
          matched = false;
          break;
        }
      }
      if (!matched) continue;
      const candidate = 12 + cost[i + token.length];
      if (candidate < best) {
        best = candidate;
        pick = index;
      }
    }

    cost[i] = best;
    choice[i] = pick;
  }

  for (let i = 0; i < n;) {
    const pick = choice[i];
    if (pick >= 0) {
      w.push(TOKEN, 6);
      w.push(pick, 6);
      i += TOKEN_BYTES[pick].length;
      continue;
    }
    const byte = bytes[i++];
    const direct = T6_INDEX.get(byte);
    if (direct !== undefined) {
      w.push(direct, 6);
    } else if (byte >= 65 && byte <= 90 && T6_INDEX.has(byte + 32)) {
      w.push(SHIFT, 6);
      w.push(T6_INDEX.get(byte + 32), 6);
    } else {
      w.push(ESC, 6);
      w.push(byte, 8);
    }
  }
  w.push(END, 6);
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

  // Every shape crossed with every body mode. The smallest payload wins, so
  // no combination of choices can beat what comes out of here.
  const shapes = shapesFor(url);
  /** @type {{payload: string, shape: shapes[0], mode: number}|null} */
  let winner = null;
  /** Best length seen per mode, across all shapes. */
  const candidates = { text6: null, raw: null, deflate: null };

  for (const shape of shapes) {
    const bytes = encoder.encode(shape.body);
    const zipped = await deflate(bytes);

    for (const mode of [MODE_TEXT6, MODE_RAW, MODE_DEFLATE]) {
      if (mode === MODE_DEFLATE && !zipped) continue;
      const payload = build(shape.flags, mode, shape.hostByte,
        mode === MODE_DEFLATE ? zipped : bytes);

      const name = MODE_NAMES[mode];
      if (candidates[name] === null || payload.length < candidates[name]) {
        candidates[name] = payload.length;
      }
      if (!winner || payload.length < winner.payload.length) {
        winner = { payload, shape, mode };
      }
    }
  }

  const { payload, shape, mode } = winner;
  const headerBits = 6 + (shape.hostByte === null ? 0 : 8);
  return {
    payload,
    url,
    mode,
    modeName: MODE_NAMES[mode],
    removed,
    host: shape.host,
    hostByte: shape.hostByte,
    headerBits,
    bodyBits: payload.length * 6 - headerBits,
    candidates,
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
      if (symbol === TOKEN) {
        const token = TOKEN_BYTES[reader.read(6)];
        if (!token) throw new ClentError("This link uses an unknown token.");
        for (const byte of token) bytes.push(byte);
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

/* -------------------------------------------------------------------------- *
 * Destination risk
 * -------------------------------------------------------------------------- */

/** Nothing worth mentioning. */
export const RISK_NONE = 0;
/** Worth showing, not worth stopping for. */
export const RISK_NOTE = 1;
/** Stop and make a human look before going there. */
export const RISK_BLOCK = 2;

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Look for the shapes phishing links take.
 *
 * A redirector is a gift to a phisher: the destination is invisible until it
 * has already happened, and the link wears this site's domain. The scheme
 * allowlist stops a payload from running code, but it does nothing about a
 * payload that points somewhere deliberately deceptive, and that is a
 * different problem needing a different answer.
 *
 * Nothing here is a verdict on whether a site is malicious — that can't be
 * known from a URL. These are the properties a normal shared link almost
 * never has and a deceptive one often does, so the page shows the destination
 * and waits instead of going there quietly.
 *
 * @param {URL} url
 * @returns {{level: number, reasons: Array<{code: string, level: number, message: string}>}}
 */
export function assess(url) {
  const reasons = [];
  const add = (code, level, message) => reasons.push({ code, level, message });

  // "https://paypal.com@evil.example/" reads as PayPal and goes to evil.
  // The oldest trick there is, and still the most effective.
  if (url.username || url.password) {
    add("userinfo", RISK_BLOCK,
      `The part before the "@" is not the destination. This link actually goes to ${url.hostname}.`);
  }

  // Punycode is how a homograph attack survives being written down:
  // "xn--pypal-4ve.com" renders as something very close to "paypal.com".
  const punycode = url.hostname.split(".").filter((label) => label.startsWith("xn--"));
  if (punycode.length) {
    add("punycode", RISK_BLOCK,
      "This address uses characters that can look like a different name.");
  }

  if (IPV4.test(url.hostname) || url.hostname.startsWith("[")) {
    add("ip-literal", RISK_BLOCK,
      "This link points at a raw IP address rather than a named site.");
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    add("port", RISK_NOTE, `It connects on port ${url.port} rather than the usual one.`);
  }

  if (url.protocol === "http:") {
    add("insecure", RISK_NOTE, "The connection is plain HTTP, so it isn't encrypted.");
  }

  return {
    level: reasons.reduce((worst, r) => Math.max(worst, r.level), RISK_NONE),
    reasons,
  };
}
