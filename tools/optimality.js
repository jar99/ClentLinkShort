/**
 * Is the encoder's answer actually the best one it could have given?
 *
 * The encoder crosses shapes with body modes and keeps the smallest — but it
 * takes one measured shortcut (deflate runs only on the shortest body), and a
 * bug in its shape or template enumeration would just make links quietly
 * longer, which no round-trip test can see.
 *
 * So this oracle enumerates every combination itself — both host spellings,
 * dictionary or spelled out, the scheme-index form, the spelled-scheme form,
 * every body mode with deflate on EVERY shape, and the template form — builds
 * a real payload for each, and reports the shortest. Anything shorter than
 * what shorten() returned is a genuine miss.
 *
 * Deliberately kept separate from the encoder's own enumeration loop: it
 * shares only exported constants and the leaf builders. If it shared
 * shapesFor(), "the encoder is never beaten" would be circular. The real
 * independence check is in the tests, which decode every candidate via
 * expand() and compare hrefs — a candidate that is shorter but wrong is a
 * failure, not a win.
 */

import {
  build, shorten, parse, stripTracking, BitWriter,
  SCHEME_HTTPS, SCHEME_HTTP, SCHEME_OTHER, SCHEME_TEMPLATE, SCHEME_IN_BODY,
  F_WWW, F_HOST, MODE_TEXT6, MODE_RAW, MODE_DEFLATE, MODE_NAMES,
} from "../src/clent.js";
import { deflate } from "../src/deflate.js";
import { HOST_INDEX } from "../src/hosts.js";
import { SCHEME_INDEX } from "../src/schemes.js";
import { asTemplate, writeTemplate } from "../src/templates.js";

const encoder = new TextEncoder();
const MODES = [MODE_TEXT6, MODE_RAW, MODE_DEFLATE];

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

  /** @type {Array<{flags: number, hostByte: number|null, schemeIndex: number|null,
   *                body: string, how: string}>} */
  const shapes = [];

  // Always available: the spelled-scheme escape hatch — the whole URL as text.
  shapes.push({
    flags: SCHEME_OTHER, hostByte: null, schemeIndex: SCHEME_IN_BODY,
    body: url.href, how: "scheme spelled in body",
  });

  // The scheme-index form, for any URL at all (the encoder only uses it for
  // non-compact URLs, but it is legal for every scheme in the table — the
  // oracle must consider it in case it ever wins).
  const schemeIndex = SCHEME_INDEX.get(url.protocol);
  if (schemeIndex !== undefined) {
    shapes.push({
      flags: SCHEME_OTHER, hostByte: null, schemeIndex,
      body: url.href.slice(url.protocol.length), how: `scheme index ${schemeIndex}`,
    });
  }

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
      shapes.push({
        flags: scheme | wwwFlag, hostByte: null, schemeIndex: null,
        body: host + tail, how: `${how}, host in body`,
      });
      const index = HOST_INDEX.get(host);
      if (index !== undefined) {
        shapes.push({
          flags: scheme | wwwFlag | F_HOST, hostByte: index, schemeIndex: null,
          body: tail, how: `${how}, dictionary #${index}`,
        });
      }
    }
  }

  const candidates = [];
  for (const shape of shapes) {
    const bytes = encoder.encode(shape.body);
    // Unlike the encoder, deflate every shape: this is the loop that polices
    // the encoder's shortest-body-only shortcut.
    const zipped = await deflate(bytes);
    for (const mode of MODES) {
      if (mode === MODE_DEFLATE && !zipped) continue;
      candidates.push({
        payload: build(shape.flags, mode, shape.hostByte,
          mode === MODE_DEFLATE ? zipped : bytes, shape.schemeIndex),
        how: `${shape.how} + ${MODE_NAMES[mode]}`,
      });
    }
  }

  // The template form, when one fits.
  const template = asTemplate(url);
  if (template) {
    const w = new BitWriter();
    w.push(SCHEME_TEMPLATE, 6);
    candidates.push({
      payload: writeTemplate(w, template),
      how: `template #${template.index}`,
    });
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
