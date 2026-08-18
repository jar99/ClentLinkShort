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
 *   huffman.js     canonical Huffman machinery
 *   text.js        the Huffman text body encoding (with token dictionary)
 *   host.js        the host field encoding (with suffix terminals)
 *   deflate.js     bounded DEFLATE
 *   tracking.js    tracking-parameter removal policy
 *   risk.js        phishing-shape assessment for the redirector
 *   hosts.js       host dictionary          (data table, append-only)
 *   textcode.js    text code + tokens       (data table, append-only)
 *   hostcode.js    host code + suffixes     (data table, append-only)
 *   templates.js   known URL shapes         (data table, append-only)
 *   schemes.js     scheme table             (data table, append-only)
 *
 * ---------------------------------------------------------------------------
 * Wire format v1
 *
 * A continuous bit stream written straight into the Base64url alphabet at
 * 6 bits per character. Nothing rounds up to a byte, so nothing is wasted.
 *
 *   6 bits  header  bits 0-1  scheme: 0 https://, 1 http://, 2 other,
 *                                     3 template
 *                   bit  2    "www." was stripped from the host
 *                   bit  3    host came from the dictionary
 *                   bits 4-5  body mode: 0 text, 1 raw, 2 deflate, 3 host
 *   index   host dictionary index (escape-coded, bits.js), only when bit 3 set
 *   body    text    Huffman-coded bytes with tokens, terminated by END
 *           raw     UTF-8 bytes, 8 bits each
 *           deflate DEFLATE-raw bytes, 8 bits each
 *           host    a host field (host.js), then the tail as text
 *
 * The host mode is what keeps arbitrary domains cheap without a dictionary
 * entry per domain: the hostname rides its own code whose terminal symbols
 * are registrable suffixes, so ".com" is a couple of bits instead of four
 * spelled characters. It is only meaningful under schemes 0-1 with bit 3
 * clear; any other combination is a decode error.
 *
 * Under scheme 2 ("other") bits 2-3 must be zero, the mode must not be 3,
 * and the header is followed by a 4-bit index into schemes.js — so "mailto:"
 * costs 4 bits, not seven body characters. Index 15 is reserved: the scheme
 * is spelled in the body. The encoder never emits 15 for a scheme the table
 * knows; the decoder accepts it so future tables can grow.
 *
 * Under scheme 3 the layout is: an escape-coded template index (bits.js),
 * then each slot as described by templates.js.
 *
 * An optional integrity tag rides OUTSIDE the payload — "#<payload>.c<tag>"
 * or ".h<tag>" — see sign.js; it never changes what the payload decodes to.
 *
 * The encoder does not decide anything by rule that it could decide by
 * measurement: every legal way of splitting the URL is priced and the
 * smallest result wins. The two deliberate shortcuts — deflate runs on one
 * body, and only when the best other candidate is long enough for deflate
 * to conceivably beat it — are documented at the deflate step inside
 * analyze(), and tools/optimality.js polices both over the corpus.
 * ---------------------------------------------------------------------------
 *
 * @module clent
 */

import {
  B64, BitWriter, BitReader, ClentError, writeIndex, readIndex, indexBits,
} from "./bits.js";
import { buildCode, pushCode, readSymbol } from "./huffman.js";
import { canCompress, deflate, inflate } from "./deflate.js";
import { planText, emitText, decodeText, END_BITS } from "./text.js";
import { hostBits, emitHost, decodeHost } from "./host.js";
import { TRACKING_PARAMS, TRACKING_BY_HOST, stripTracking } from "./tracking.js";
import { RISK_NONE, RISK_NOTE, RISK_BLOCK, assess } from "./risk.js";
import { HOSTS, HOST_INDEX } from "./hosts.js";
import {
  TEMPLATES, asTemplate, writeTemplate, readTemplate,
} from "./templates.js";
import {
  ENCODABLE_ORDER, SCHEME_INDEX, SCHEME_BITS, SCHEME_IN_BODY,
  ENCODABLE, FOLLOWABLE,
} from "./schemes.js";
import { decodeTransport } from "./transport.js";

// One import serves every caller; the module boundaries stay an internal
// affair. (The page bundler strips these re-export lines when it merges the
// modules into a single scope.)
export { B64, BitWriter, BitReader, ClentError } from "./bits.js";
export { canCompress, deflate, inflate, MAX_INFLATED } from "./deflate.js";
export { planText, emitText, decodeText, textBits } from "./text.js";
export { hostBits, emitHost, decodeHost } from "./host.js";
export { TRACKING_PARAMS, TRACKING_BY_HOST, stripTracking } from "./tracking.js";
export { RISK_NONE, RISK_NOTE, RISK_BLOCK, assess } from "./risk.js";
export { HOSTS } from "./hosts.js";
export { TOKENS } from "./textcode.js";
export { SUFFIXES } from "./hostcode.js";
export { TEMPLATES } from "./templates.js";
export {
  ENCODABLE_ORDER, SCHEME_BITS, SCHEME_IN_BODY, ENCODABLE, FOLLOWABLE,
} from "./schemes.js";
export {
  isEmoji, toEmoji, fromEmoji, isDense, toDense, fromDense, decodeTransport,
} from "./transport.js";

/**
 * Wire format version this build writes. Version 1 is FROZEN: its tables
 * (textcode, hostcode, and the existing prefixes of hosts, templates and
 * schemes) never change, so every link ever made keeps decoding. Future
 * formats ride the VERSION_ESCAPE envelope instead of replacing this one;
 * test/compat.test.js holds the contract in place.
 */
export const VERSION = 1;

/**
 * Reserved header symbol marking a payload from a future wire version: 4
 * version bits follow its codeword. Never a legal v1 header; the v1 encoder
 * never emits it.
 */
export const VERSION_ESCAPE = 62;

/**
 * The header is one symbol of its own canonical Huffman code, not a flat 6
 * bits: the header's measured entropy over the corpus is 2.6 bits, so the
 * common shapes ("https, host mode", "https, dict host, text tail") cost
 * 2-3 bits and the rare-but-legal combinations up to 12. All 64 values keep
 * a codeword — combinations this encoder never produces still parse, then
 * fail the same validity checks as before. Symbol 62 is VERSION_ESCAPE.
 * Mined by tools/mine-header.mjs; frozen with the other tables.
 */
export const HEADER_CODE_LENGTHS = Object.freeze([
  6, 9, 12, 3, 9, 9, 12, 12, 4, 5, 12, 12, 5, 4, 12, 12,
  12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
  12, 11, 12, 12, 12, 12, 12, 12, 7, 11, 12, 12, 12, 12, 12, 12,
  2, 4, 12, 12, 5, 4, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
]);

const HEADER_CODE = buildCode(HEADER_CODE_LENGTHS);
/** Bits the header symbol costs, by header value. */
const HEADER_LEN = HEADER_CODE.len;

export const SCHEME_HTTPS = 0, SCHEME_HTTP = 1, SCHEME_OTHER = 2,
  SCHEME_TEMPLATE = 3;

export const MODE_TEXT = 0, MODE_RAW = 1, MODE_DEFLATE = 2, MODE_HOST = 3;
/**
 * Analysis-level marker for a template win. NEVER a wire value — on the wire
 * a template is scheme 3 and the mode bits stay zero.
 */
export const MODE_TEMPLATE = 4;

/** @type {readonly string[]} Human-readable mode names, indexed by mode. */
export const MODE_NAMES = Object.freeze(["text", "raw", "deflate", "host", "template"]);

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

/**
 * Deflate is skipped entirely when the best other candidate is already
 * shorter than this many characters. Measured over the full corpus: the
 * smallest payload deflate has ever won at is 20 characters, because a
 * DEFLATE stream has fixed costs no short body can amortise. The margin
 * below the measurement is deliberate; tools/optimality.js re-checks the
 * corpus without this gate, so a shift in the floor shows up as a
 * suboptimality instead of passing silently.
 */
export const DEFLATE_FLOOR = 18;

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
 * Encoding
 * -------------------------------------------------------------------------- */

/**
 * Assemble one complete candidate payload.
 * @param {number} flags
 * @param {number} mode
 * @param {number|null} hostByte
 * @param {Uint8Array} bytes body bytes; under MODE_HOST, the tail only
 * @param {number|null} [schemeIndex] required exactly when flags carry SCHEME_OTHER
 * @param {string|null} [host] required exactly when mode is MODE_HOST
 * @returns {string}
 */
export function build(flags, mode, hostByte, bytes, schemeIndex = null, host = null) {
  const w = new BitWriter();
  pushCode(w, HEADER_CODE, flags | (mode << 4));
  if ((flags & SCHEME_MASK) === SCHEME_OTHER) {
    if (schemeIndex === null)
      throw new ClentError("A scheme-2 payload needs a scheme index.");
    w.push(schemeIndex, SCHEME_BITS);
  }
  if (hostByte !== null) writeIndex(w, hostByte);

  if (mode === MODE_HOST) {
    if (host === null) throw new ClentError("A host-mode payload needs a host.");
    emitHost(w, host);
    emitText(w, bytes);
  } else if (mode === MODE_TEXT) {
    emitText(w, bytes);
  } else {
    for (const byte of bytes) w.push(byte, 8);
  }
  return w.finish();
}

/** Payload characters for a total bit count: 6 bits each, padded up. */
const chars = (bits) => Math.ceil(bits / 6);

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
 * @property {number} headerBits bits spent on the header, scheme and host index
 * @property {number} bodyBits bits spent on the body
 * @property {number} hostFieldBits bits spent on the host field; 0 outside MODE_HOST
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

  // The compact forms have nowhere to keep userinfo, and silently dropping
  // it would repoint the link — so those go through the "other" scheme,
  // which keeps the whole rest of the URL as the body.
  const compact =
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username && !url.password;

  const schemeIndex = SCHEME_INDEX.get(url.protocol);

  // Sliced out of href rather than assembled from pathname + search + hash:
  // those drop a trailing empty "?" or "#", which changes the destination.
  // The lone "/" is implied on the way back — for the compact schemes by
  // reconstruction, for scheme 2 by URL normalisation in finish(). (For
  // non-compact schemes url.origin is the string "null"; tail goes unused.)
  let tail = compact ? url.href.slice(url.origin.length) : "";
  if (tail === "/") tail = "";

  // One byte string covers every candidate body: each body the encoder can
  // choose is a suffix of "//host…tail", and the text plan is computed
  // backwards from the end, so a single plan prices all of them by offset.
  const full = compact
    ? "//" + url.host + tail
    : url.href.slice(url.protocol.length);
  const bytes = encoder.encode(full);
  const plan = planText(bytes);

  /** bits for the text body starting at byte offset `at` */
  const textBitsAt = (at) => plan.cost[at] + END_BITS;

  /**
   * Candidate shapes: each knows its header cost, its body offset into
   * `bytes`, and how to build itself. Body modes text/raw price by
   * arithmetic; only the winner is actually built.
   * @type {Array<{extraBits: number, at: number, flags: number, hostByte: number|null, schemeIndex: number|null, host: string|null}>}
   */
  const shapes = [];

  // The scheme-index form is legal for every scheme, http/https included,
  // and the oracle proved it can win there: its body starts "//", and a
  // host that begins with a token suffix ("//index…") gets the token where
  // the compact body cannot.
  shapes.push({
    extraBits: SCHEME_BITS, at: 0, flags: SCHEME_OTHER,
    hostByte: null, schemeIndex, host: null,
  });

  /** Host-field candidates, priced separately (host bits + text tail). */
  const hostShapes = [];

  if (compact) {
    const scheme = url.protocol === "http:" ? SCHEME_HTTP : SCHEME_HTTPS;
    const tailAt = bytes.length - encoder.encode(tail).length;

    // Both spellings of the host, where there is a choice: stripping "www."
    // trades four characters for a header bit, but a token that matches the
    // full spelling can beat the strip, so both are priced.
    const spellings = [{ host: url.host, extra: 0, at: 2 }];
    if (url.host.startsWith("www.")) {
      spellings.push({ host: url.host.slice(4), extra: F_WWW, at: 6 });
    }

    for (const { host, extra, at } of spellings) {
      const index = HOST_INDEX.get(host);
      if (index !== undefined) {
        shapes.push({
          extraBits: indexBits(index), at: tailAt, flags: scheme | extra | F_HOST,
          hostByte: index, schemeIndex: null, host,
        });
      }
      shapes.push({
        extraBits: 0, at, flags: scheme | extra,
        hostByte: null, schemeIndex: null, host,
      });
      // hostBits is Infinity for a host the decoder would refuse (too
      // long); such a shape must not enter the race at all.
      const fieldBits = hostBits(host);
      if (Number.isFinite(fieldBits)) {
        hostShapes.push({
          extraBits: 0, at: tailAt, flags: scheme | extra,
          host, hostFieldBits: fieldBits,
        });
      }
    }
  }

  /** Best payload length seen per mode name. @type {Record<string, number|null>} */
  const candidates = { text: null, raw: null, deflate: null, host: null };
  /** @type {{chars: number, shape: (typeof shapes)[0], mode: number}|null} */
  let winner = null;
  // The header symbol's cost depends on the mode as well as the flags, so
  // it is priced here, where the two meet — not stored on the shape.
  const headerBits = (shape, mode) =>
    HEADER_LEN[shape.flags | (mode << 4)] + shape.extraBits;
  const consider = (length, shape, mode) => {
    const name = MODE_NAMES[mode];
    if (candidates[name] === null || length < candidates[name]) {
      candidates[name] = length;
    }
    if (!winner || length < winner.chars) winner = { chars: length, shape, mode };
  };

  for (const shape of shapes) {
    consider(chars(headerBits(shape, MODE_TEXT) + textBitsAt(shape.at)),
      shape, MODE_TEXT);
    consider(chars(headerBits(shape, MODE_RAW) + 8 * (bytes.length - shape.at)),
      shape, MODE_RAW);
  }
  for (const shape of hostShapes) {
    consider(chars(headerBits(shape, MODE_HOST) + shape.hostFieldBits +
      textBitsAt(shape.at)), /** @type {any} */ (shape), MODE_HOST);
  }

  // Deflate is genuinely expensive — an async stream per call — and almost
  // never wins, so it runs at most once, on the shortest body, and only when
  // the best candidate so far is long enough for deflate to conceivably
  // beat it (see DEFLATE_FLOOR). DEFLATE is also not monotonic in input
  // length, so a strictly longer body can, rarely, compress one character
  // smaller — the oracle found one such URL in 4,000 (a 1-character loss).
  // All three shortcuts are policed by tools/optimality.js, which builds
  // every shape and mode without them and keeps the loss bounded and
  // visible.
  let zipped = null;
  if (canCompress && winner.chars >= DEFLATE_FLOOR) {
    let shortest = shapes[0];
    for (const shape of shapes) if (shape.at > shortest.at) shortest = shape;
    const stream = await deflate(bytes.subarray(shortest.at));
    if (stream) {
      zipped = { stream, shape: shortest };
      consider(chars(headerBits(shortest, MODE_DEFLATE) + 8 * stream.length),
        shortest, MODE_DEFLATE);
    }
  }

  // A template, when one fits, is just another candidate: it wins on length
  // or it does not get used.
  const template = asTemplate(url);
  let templateLength = null;
  if (template) {
    const w = new BitWriter();
    // Mode bits stay 0: slots are self-describing.
    pushCode(w, HEADER_CODE, SCHEME_TEMPLATE);
    const payload = writeTemplate(w, template);
    templateLength = payload.length;
    if (payload.length < winner.chars) {
      const templateHeaderBits =
        HEADER_LEN[SCHEME_TEMPLATE] + indexBits(template.index);
      return {
        payload,
        url,
        mode: MODE_TEMPLATE,
        modeName: MODE_NAMES[MODE_TEMPLATE],
        removed,
        host: url.host,
        hostByte: null,
        template: template.index,
        templatePattern: TEMPLATES[template.index].pattern,
        headerBits: templateHeaderBits,
        bodyBits: payload.length * 6 - templateHeaderBits,
        hostFieldBits: 0,
        candidates: { ...candidates, template: payload.length },
      };
    }
  }

  // Build only the winner; everything else was priced, not built.
  const { shape, mode } = winner;
  const payload = mode === MODE_DEFLATE
    ? build(shape.flags, MODE_DEFLATE, shape.hostByte, zipped.stream,
        shape.schemeIndex)
    : mode === MODE_HOST
      ? build(shape.flags, MODE_HOST, null, bytes.subarray(shape.at), null, shape.host)
      : build(shape.flags, mode, shape.hostByte, bytes.subarray(shape.at),
          shape.schemeIndex);
  return finishAnalysis(payload, url, mode, removed, shape, candidates,
    templateLength, headerBits(shape, mode));
}

/**
 * Assemble the Analysis record for a non-template winner.
 * @param {string} payload
 * @param {URL} url
 * @param {number} mode
 * @param {string[]} removed
 * @param {{hostByte?: number|null, host?: string|null, hostFieldBits?: number}} shape
 * @param {Record<string, number|null>} candidates
 * @param {number|null} templateLength
 * @param {number} headerBits header symbol plus scheme/host index bits
 * @returns {Analysis}
 */
function finishAnalysis(payload, url, mode, removed, shape, candidates,
    templateLength, headerBits) {
  const hostFieldBits = mode === MODE_HOST ? shape.hostFieldBits ?? 0 : 0;
  return {
    payload,
    url,
    mode,
    modeName: MODE_NAMES[mode],
    removed,
    host: shape.host ?? null,
    hostByte: shape.hostByte ?? null,
    template: null,
    templatePattern: null,
    headerBits,
    bodyBits: payload.length * 6 - headerBits - hostFieldBits,
    hostFieldBits,
    candidates: { ...candidates, template: templateLength },
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
  let code = String(payload ?? "");
  if (!code) throw new ClentError("This link is empty.");
  if (code.length > MAX_PAYLOAD) throw new ClentError("This link is far too long.");
  // An emoji-dressed payload undresses to the canonical form first.
  code = decodeTransport(code);
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new ClentError("This isn't a valid Clent link.");

  const reader = new BitReader(code);
  const header = readSymbol(reader, HEADER_CODE);

  // The forward-compatibility escape. Header value 62 was never a legal v1
  // header — scheme 2 forbids the www/host bits — so its codeword is
  // reserved as the envelope for future wire versions: 4 version bits
  // follow, then that version's own format. This decoder knows none yet;
  // the promise is that it fails with the right message instead of
  // misreading, and that v1 payloads decode forever.
  if (header === VERSION_ESCAPE) {
    reader.read(4);
    throw new ClentError(
      "This link was made by a newer version of Clent. Refresh this page and try again.");
  }

  const flags = header & 0b1111;
  const mode = (header >> 4) & 0b11;

  // Templates have their own layout after the header, so they branch first.
  if ((flags & SCHEME_MASK) === SCHEME_TEMPLATE) {
    return finish(readTemplate(reader));
  }

  const scheme = flags & SCHEME_MASK;

  // Scheme 2 has its own layout: bits 2-3 must be clear, the mode must be a
  // plain body mode, then a 4-bit index into the scheme table.
  let schemeIndex = null;
  if (scheme === SCHEME_OTHER) {
    if ((flags & (F_WWW | F_HOST)) || mode === MODE_HOST)
      throw new ClentError("This link uses an unknown format.");
    schemeIndex = reader.read(SCHEME_BITS);
    if (schemeIndex !== SCHEME_IN_BODY && schemeIndex >= ENCODABLE_ORDER.length)
      throw new ClentError("This link uses a newer scheme table than this page has.");
  }

  // The host mode carries the host in its own field; a dictionary index and
  // a host field at once is no format this encoder writes.
  if (mode === MODE_HOST && (flags & F_HOST))
    throw new ClentError("This link uses an unknown format.");

  const hostIndex = flags & F_HOST ? readIndex(reader) : null;

  let fieldHost = null;
  let body;
  if (mode === MODE_HOST) {
    fieldHost = decodeHost(reader);
    body = decodeText(reader);
  } else if (mode === MODE_TEXT) {
    body = decodeText(reader);
  } else {
    const count = Math.floor(reader.left / 8); // trailing padding is under 8 bits
    const raw = new Uint8Array(count);
    for (let i = 0; i < count; i++) raw[i] = reader.read(8);
    body = decoder.decode(mode === MODE_DEFLATE ? await inflate(raw) : raw);
  }

  let href;
  if (scheme === SCHEME_OTHER) {
    href = schemeIndex === SCHEME_IN_BODY ? body : ENCODABLE_ORDER[schemeIndex] + body;
  } else if (scheme === SCHEME_HTTPS || scheme === SCHEME_HTTP) {
    let host, tail;
    if (fieldHost !== null) {
      host = fieldHost;
      tail = body;
    } else if (hostIndex !== null) {
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
