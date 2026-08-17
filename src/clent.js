/**
 * Clent — a stateless URL codec.
 *
 * Packs a URL into a short, URL-safe string that contains the whole
 * destination, so no storage is needed anywhere to resolve it back.
 *
 * Zero dependencies. Runs unmodified in browsers and in Node >= 18.
 *
 * This module is the codec core and the public API; the pieces live in
 * focused modules and are re-exported here so callers need one import:
 *
 *   bits.js        the bit stream and ClentError
 *   text6.js       the 6-bit text body encoding (with token dictionary)
 *   deflate.js     bounded DEFLATE
 *   tracking.js    tracking-parameter removal policy
 *   risk.js        phishing-shape assessment for the redirector
 *   hosts.js       host dictionary          (data table, append-only)
 *   tokens.js      text6 substring tokens   (data table, append-only)
 *   templates.js   known URL shapes         (data table, append-only)
 *
 * ---------------------------------------------------------------------------
 * Wire format v6
 *
 * A continuous bit stream written straight into the Base64url alphabet at
 * 6 bits per character. Nothing rounds up to a byte, so nothing is wasted.
 *
 *   6 bits  header  bits 0-1  scheme: 0 https://, 1 http://, 2 other,
 *                                     3 template
 *                   bit  2    "www." was stripped from the host
 *                   bit  3    host came from the dictionary
 *                   bits 4-5  body mode: 0 text6, 1 raw, 2 deflate
 *   8 bits  host dictionary index, present only when bit 3 is set
 *   body    text6   6-bit symbols, terminated by END
 *           raw     UTF-8 bytes, 8 bits each
 *           deflate DEFLATE-raw bytes, 8 bits each
 *
 * Under scheme 2 ("other") bits 2-3 must be zero and the header is followed
 * by a 4-bit index into schemes.js — so "mailto:" costs 4 bits, not seven
 * body characters. Index 15 is reserved: the scheme is spelled in the body,
 * which is exactly the old verbatim form. The encoder never emits 15 for a
 * scheme the table knows; the decoder accepts it so future tables can grow.
 *
 * Under scheme 3 the layout is: 8 bits of template index, then each slot as
 * 6 bits of length followed by its characters at whatever width that slot's
 * alphabet needs.
 *
 * An optional integrity tag rides OUTSIDE the payload — "#<payload>.c<tag>"
 * or ".h<tag>" — see sign.js; it never changes what the payload decodes to.
 *
 * The encoder does not decide anything by rule that it could decide by
 * measurement: every legal way of splitting the URL is crossed with every
 * body mode and the smallest result wins. The one deliberate exception is
 * documented at the deflate step inside analyze(), and tools/optimality.js
 * polices it over the corpus.
 * ---------------------------------------------------------------------------
 *
 * @module clent
 */

import { B64, BitWriter, BitReader, ClentError } from "./bits.js";
import { canCompress, deflate, inflate } from "./deflate.js";
import { T6, emitText6, decodeText6 } from "./text6.js";
import { TRACKING_PARAMS, TRACKING_BY_HOST, stripTracking } from "./tracking.js";
import { RISK_NONE, RISK_NOTE, RISK_BLOCK, assess } from "./risk.js";
import { HOSTS, HOST_INDEX } from "./hosts.js";
import { TOKENS } from "./tokens.js";
import {
  TEMPLATES, asTemplate, writeTemplate, readTemplate,
} from "./templates.js";
import {
  ENCODABLE_ORDER, SCHEME_INDEX, SCHEME_BITS, SCHEME_IN_BODY,
  ENCODABLE, FOLLOWABLE,
} from "./schemes.js";

// One import serves every caller; the module boundaries stay an internal
// affair. (The page bundler strips these re-export lines when it merges the
// modules into a single scope.)
export { B64, BitWriter, BitReader, ClentError } from "./bits.js";
export { canCompress, deflate, inflate, MAX_INFLATED } from "./deflate.js";
export { T6, emitText6, decodeText6 } from "./text6.js";
export { TRACKING_PARAMS, TRACKING_BY_HOST, stripTracking } from "./tracking.js";
export { RISK_NONE, RISK_NOTE, RISK_BLOCK, assess } from "./risk.js";
export { HOSTS } from "./hosts.js";
export { TOKENS } from "./tokens.js";
export { TEMPLATES } from "./templates.js";
export {
  ENCODABLE_ORDER, SCHEME_BITS, SCHEME_IN_BODY, ENCODABLE, FOLLOWABLE,
} from "./schemes.js";

/** Wire format version this build reads and writes. */
export const VERSION = 6;

export const SCHEME_HTTPS = 0, SCHEME_HTTP = 1, SCHEME_OTHER = 2,
  SCHEME_TEMPLATE = 3;
/** @deprecated v5 name for {@link SCHEME_OTHER}. */
export const SCHEME_VERBATIM = SCHEME_OTHER;

export const MODE_TEXT6 = 0, MODE_RAW = 1, MODE_DEFLATE = 2;
/**
 * Analysis-level marker for a template win. NEVER a wire value — on the wire
 * a template is scheme 3 and the mode bits stay zero.
 */
export const MODE_TEMPLATE = 3;

/** @type {readonly string[]} Human-readable mode names, indexed by mode. */
export const MODE_NAMES = Object.freeze(["text6", "raw", "deflate", "template"]);

const SCHEME_MASK = 0b11;
/** Header bit: "www." was stripped from the host. */
export const F_WWW = 0b100;
/** Header bit: the host is a dictionary index. */
export const F_HOST = 0b1000;

/**
 * Longest URL the codec will encode or return. Far past anything real — the
 * corpus tops out near 4,000 — but a hard edge, so degenerate input fails
 * with a message instead of tying up the page.
 */
export const MAX_URL = 8192;

/**
 * Longest payload expand() will read. Generous: the least dense winning mode
 * is raw at ~4/3 characters per byte, so every compliant payload for a
 * MAX_URL input fits with room to spare.
 */
export const MAX_PAYLOAD = 16384;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* -------------------------------------------------------------------------- *
 * Parsing
 * -------------------------------------------------------------------------- */

/**
 * Parse user input into a URL, tolerating a missing scheme.
 * @param {string} input
 * @returns {URL}
 * @throws {ClentError}
 */
export function parse(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) throw new ClentError("Paste a URL first.");
  if (trimmed.length > MAX_URL)
    throw new ClentError(`That is too long to be a URL (over ${MAX_URL} characters).`);
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

/* -------------------------------------------------------------------------- *
 * Shapes
 * -------------------------------------------------------------------------- */

/**
 * Every way this URL could legitimately be split for the wire format.
 *
 * More than one, because the choices interact — see the note on "www." below.
 * The encoder builds all of them and keeps the smallest result, so the choice
 * is measured rather than assumed.
 *
 * @param {URL} url
 * @returns {Array<{flags: number, schemeIndex: number|null, hostByte: number|null, body: string, host: string|null}>}
 */
function shapesFor(url) {
  // The compact form has nowhere to keep userinfo, and silently dropping it
  // would repoint the link — so those go through the "other" scheme, which
  // keeps the whole rest of the URL as the body.
  const compact =
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username && !url.password;

  if (!compact) {
    // parse() already gated on ENCODABLE, so the scheme is always in the
    // table; the 4-bit index replaces spelling it out in the body.
    const schemeIndex = SCHEME_INDEX.get(url.protocol);
    return [{
      flags: SCHEME_OTHER,
      schemeIndex,
      hostByte: null,
      body: url.href.slice(url.protocol.length),
      host: null,
    }];
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
      shapes.push({
        flags: scheme | extra | F_HOST, schemeIndex: null,
        hostByte: index, body: tail, host,
      });
    }
    shapes.push({
      flags: scheme | extra, schemeIndex: null,
      hostByte: null, body: host + tail, host,
    });
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
 * @param {number|null} [schemeIndex] required exactly when flags carry SCHEME_OTHER
 * @returns {string}
 */
export function build(flags, mode, hostByte, bytes, schemeIndex = null) {
  const w = new BitWriter();
  w.push(flags | (mode << 4), 6);
  if ((flags & SCHEME_MASK) === SCHEME_OTHER) {
    if (schemeIndex === null)
      throw new ClentError("A scheme-2 payload needs a scheme index.");
    w.push(schemeIndex, SCHEME_BITS);
  }
  if (hostByte !== null) w.push(hostByte, 8);

  if (mode === MODE_TEXT6) {
    emitText6(w, bytes);
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
 * @property {number|null} template winning template index, or null
 * @property {string|null} templatePattern winning template's pattern, or null
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
  /** @type {{payload: string, shape: (typeof shapes)[0], mode: number}|null} */
  let winner = null;

  // A template, when one fits, is just another candidate: it wins on length
  // or it does not get used.
  const template = asTemplate(url);
  const templateCandidate = template
    ? {
        payload: (() => {
          const w = new BitWriter();
          w.push(SCHEME_TEMPLATE, 6); // mode bits stay 0: slots are self-describing
          return writeTemplate(w, template);
        })(),
        index: template.index,
      }
    : null;
  /** Best length seen per mode, across all shapes. */
  const candidates = { text6: null, raw: null, deflate: null };

  // Deflate costs about three quarters of the time spent encoding, so it runs
  // once rather than once per shape, on the shortest body. That is the one
  // measured shortcut in the encoder, and it is not perfectly safe: DEFLATE
  // is not monotonic in input length, so a strictly longer body can, rarely,
  // compress one character smaller — the oracle found exactly one such URL in
  // 4,000 (a 1-character loss). Accepted: closing it means deflating every
  // shape, which measured at ~56% of encode throughput. tools/optimality.js
  // builds every shape and mode without this shortcut and keeps the loss
  // bounded and visible.
  const encoded = shapes.map((shape) => encoder.encode(shape.body));
  let shortest = 0;
  for (let i = 1; i < encoded.length; i++) {
    if (encoded[i].length < encoded[shortest].length) shortest = i;
  }
  const zippedShortest = await deflate(encoded[shortest]);

  for (let index = 0; index < shapes.length; index++) {
    const shape = shapes[index];
    const bytes = encoded[index];
    const zipped = index === shortest ? zippedShortest : null;

    for (const mode of [MODE_TEXT6, MODE_RAW, MODE_DEFLATE]) {
      if (mode === MODE_DEFLATE && !zipped) continue;
      const payload = build(shape.flags, mode, shape.hostByte,
        mode === MODE_DEFLATE ? zipped : bytes, shape.schemeIndex);

      const name = MODE_NAMES[mode];
      if (candidates[name] === null || payload.length < candidates[name]) {
        candidates[name] = payload.length;
      }
      if (!winner || payload.length < winner.payload.length) {
        winner = { payload, shape, mode };
      }
    }
  }

  if (templateCandidate && templateCandidate.payload.length < winner.payload.length) {
    return {
      payload: templateCandidate.payload,
      url,
      mode: MODE_TEMPLATE,
      modeName: MODE_NAMES[MODE_TEMPLATE],
      removed,
      host: url.host,
      hostByte: null,
      template: templateCandidate.index,
      templatePattern: TEMPLATES[templateCandidate.index].pattern,
      headerBits: 14,
      bodyBits: templateCandidate.payload.length * 6 - 14,
      candidates: { ...candidates, template: templateCandidate.payload.length },
    };
  }

  const { payload, shape, mode } = winner;
  const headerBits = 6 + (shape.hostByte === null ? 0 : 8) +
    (shape.schemeIndex === null ? 0 : SCHEME_BITS);
  return {
    payload,
    url,
    mode,
    modeName: MODE_NAMES[mode],
    removed,
    host: shape.host,
    hostByte: shape.hostByte,
    template: null,
    templatePattern: null,
    headerBits,
    bodyBits: payload.length * 6 - headerBits,
    candidates: {
      ...candidates,
      template: templateCandidate ? templateCandidate.payload.length : null,
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
  if (code.length > MAX_PAYLOAD) throw new ClentError("This link is far too long.");
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ClentError("This isn't a valid Clent link.");

  const reader = new BitReader(code);
  const header = reader.read(6);
  const flags = header & 0b1111;
  const mode = (header >> 4) & 0b11;

  // Templates have their own layout after the header, so they branch first.
  if ((flags & SCHEME_MASK) === SCHEME_TEMPLATE) {
    return finish(readTemplate(reader));
  }

  const scheme = flags & SCHEME_MASK;

  // Scheme 2 has its own layout: bits 2-3 must be clear, then a 4-bit index
  // into the scheme table before the body.
  let schemeIndex = null;
  if (scheme === SCHEME_OTHER) {
    if (flags & (F_WWW | F_HOST))
      throw new ClentError("This link uses an unknown format.");
    schemeIndex = reader.read(SCHEME_BITS);
    if (schemeIndex !== SCHEME_IN_BODY && schemeIndex >= ENCODABLE_ORDER.length)
      throw new ClentError("This link uses a newer scheme table than this page has.");
  }

  const hostIndex = flags & F_HOST ? reader.read(8) : null;

  let body;
  if (mode === MODE_TEXT6) {
    body = decodeText6(reader);
  } else if (mode === MODE_RAW || mode === MODE_DEFLATE) {
    const count = Math.floor(reader.left / 8); // trailing padding is under 8 bits
    const bytes = new Uint8Array(count);
    for (let i = 0; i < count; i++) bytes[i] = reader.read(8);
    body = decoder.decode(mode === MODE_DEFLATE ? await inflate(bytes) : bytes);
  } else {
    throw new ClentError("This link uses an unknown format.");
  }

  let href;
  if (scheme === SCHEME_OTHER) {
    href = schemeIndex === SCHEME_IN_BODY ? body : ENCODABLE_ORDER[schemeIndex] + body;
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

  return finish(href);
}

/**
 * Final gate for every decode path, template or not: it has to be a sane
 * length, it has to parse, and it has to have a scheme we are willing to
 * hand to a browser.
 * @param {string} href
 * @returns {URL}
 */
function finish(href) {
  // Re-checked here, not only in parse(): a crafted payload never went
  // through parse() on the way in.
  if (href.length > MAX_URL)
    throw new ClentError("This link decodes to something far too long to be a URL.");
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
