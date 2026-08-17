/**
 * Is the encoder's answer actually the best one it could have given?
 *
 * `shorten()` tries three body encodings and keeps the shortest, but that is
 * only part of the decision. It also decides whether to use the host
 * dictionary, whether to strip a `www.` prefix, and whether to fall back to
 * storing the URL verbatim — and it makes each of those once, up front, by a
 * rule rather than by measurement.
 *
 * This enumerates every combination of those choices, builds a real payload
 * for each, and reports the shortest. Anything shorter than what `shorten()`
 * returned is a genuine miss: a link that could have been smaller.
 *
 * Every candidate here is a legitimate encoding that `expand()` decodes back
 * to the same URL, which the tests check — otherwise "shorter" would just mean
 * "wrong".
 */

import {
  build, shorten, parse, stripTracking, deflate, HOSTS,
  MODE_TEXT6, MODE_RAW, MODE_DEFLATE,
} from "../src/clent.js";

const HOST_INDEX = new Map(HOSTS.map((h, i) => [h, i]));
const encoder = new TextEncoder();
const MODES = [MODE_TEXT6, MODE_RAW, MODE_DEFLATE];

const SCHEME_HTTPS = 0, SCHEME_HTTP = 1, SCHEME_VERBATIM = 2;
const F_WWW = 0b100, F_HOST = 0b1000;

/**
 * @typedef {object} Candidate
 * @property {string} payload
 * @property {string} how human-readable description of the choices made
 */

/**
 * Build every payload that would correctly encode this URL.
 *
 * @param {string|URL} input
 * @param {{stripTracking?: boolean}} [options]
 * @returns {Promise<Candidate[]>}
 */
export async function allCandidates(input, { stripTracking: clean = false } = {}) {
  const url = parse(input instanceof URL ? input.href : input);
  if (clean && (url.protocol === "http:" || url.protocol === "https:")) stripTracking(url);

  /** @type {Array<{flags: number, hostByte: number|null, body: string, how: string}>} */
  const shapes = [];

  // Always available: store the whole URL as text and let the decoder parse it.
  shapes.push({
    flags: SCHEME_VERBATIM, hostByte: null, body: url.href, how: "verbatim",
  });

  const compactable =
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username && !url.password;

  if (compactable) {
    const scheme = url.protocol === "http:" ? SCHEME_HTTP : SCHEME_HTTPS;
    let tail = url.href.slice(url.origin.length);
    if (tail === "/") tail = "";

    // Both spellings of the host, where "www." is present.
    const spellings = [{ host: url.host, wwwFlag: 0, how: "keep www" }];
    if (url.host.startsWith("www.")) {
      spellings.push({ host: url.host.slice(4), wwwFlag: F_WWW, how: "strip www" });
    }

    for (const { host, wwwFlag, how } of spellings) {
      // Host spelled out in the body.
      shapes.push({
        flags: scheme | wwwFlag,
        hostByte: null,
        body: host + tail,
        how: `${how}, host in body`,
      });
      // Host as a dictionary index, when it has one.
      const index = HOST_INDEX.get(host);
      if (index !== undefined) {
        shapes.push({
          flags: scheme | wwwFlag | F_HOST,
          hostByte: index,
          body: tail,
          how: `${how}, dictionary #${index}`,
        });
      }
    }
  }

  const candidates = [];
  for (const shape of shapes) {
    const bytes = encoder.encode(shape.body);
    const zipped = await deflate(bytes);
    for (const mode of MODES) {
      if (mode === MODE_DEFLATE && !zipped) continue;
      candidates.push({
        payload: build(shape.flags, mode, shape.hostByte,
          mode === MODE_DEFLATE ? zipped : bytes),
        how: `${shape.how} + ${["text6", "raw", "deflate"][mode]}`,
      });
    }
  }
  return candidates;
}

/**
 * Compare what the encoder produced against the best possible encoding.
 *
 * @param {string} url
 * @param {{stripTracking?: boolean}} [options]
 * @returns {Promise<{url: string, actual: string, best: string, how: string,
 *                    wasted: number, optimal: boolean}>}
 */
export async function checkOptimal(url, options = {}) {
  const actual = await shorten(url, { stripTracking: false, ...options });
  const candidates = await allCandidates(url, options);

  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.payload.length < best.payload.length) best = candidate;
  }

  return {
    url,
    actual,
    best: best.payload,
    how: best.how,
    wasted: actual.length - best.payload.length,
    optimal: actual.length <= best.payload.length,
  };
}
