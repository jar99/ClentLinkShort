/**
 * URL templates.
 *
 * A great many shared links are one site's URL scheme with an identifier
 * dropped into it. `https://www.youtube.com/watch?v=dQw4w9WgXcQ` is 43
 * characters of which 11 carry information; the rest is a shape repeated
 * across every YouTube link ever shared.
 *
 * A template names that shape once and stores only the identifier. The saving
 * is twofold: the boilerplate disappears, and the identifier is encoded at
 * exactly the width its own alphabet needs. A YouTube ID is 11 characters of
 * Base64url, which is 66 bits — while the general text encoder, which has to
 * pay a shift symbol for every capital, would spend closer to 100.
 *
 * APPEND-ONLY once published: an index is a wire encoding.
 *
 * Correctness rule, enforced by asTemplate() below: a template is only used
 * if substituting the captured values back into the pattern reproduces the
 * original URL character for character. Anything else would be a silent
 * redirect to the wrong place, which is the one failure that must never ship.
 *
 * Templates apply to https URLs only — every pattern is an https literal, and
 * asTemplate() bails early on anything else. That is a table property, not a
 * codec rule: an http pattern added here would work.
 */

import { ClentError } from "./bits.js";
import { emitText, decodeText, textBits } from "./text.js";

const slotEncoder = new TextEncoder();

/**
 * Slot alphabets. `bits` is what one character costs; a character outside the
 * alphabet disqualifies the template for that URL.
 *
 * The special slot type "text" is not listed here: it is Huffman-coded by
 * text.js, END-terminated instead of length-prefixed, and accepts any value —
 * capitals, dots, percent-escapes — at the text mode's own cost. Use it for
 * slugs and titles; use a charset for dense IDs, which beat it.
 * @type {Readonly<Record<string, {chars: string, bits: number}>>}
 */
export const CHARSETS = Object.freeze({
  // Base64url — YouTube video IDs, many CDN keys.
  b64: { chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", bits: 6 },
  // Digits — status IDs, numeric post IDs. 4 bits rather than the 6 a text
  // encoder would spend.
  dec: { chars: "0123456789", bits: 4 },
  // Uppercase and digits — Amazon ASINs, order references.
  up36: { chars: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", bits: 6 },
  // Lowercase URL-slug characters — usernames, repository names, article slugs.
  slug: { chars: "abcdefghijklmnopqrstuvwxyz0123456789-_.", bits: 6 },
  // Lowercase hex — commit hashes, content digests.
  hex: { chars: "0123456789abcdef", bits: 4 },
});

/**
 * The templates themselves.
 *
 * `{0}`, `{1}` mark slots, in order. `slots` gives each one's alphabet.
 * Patterns are matched against the URL exactly as the URL parser normalises
 * it, so they carry the `www.` and trailing slash the browser would produce.
 *
 * @type {ReadonlyArray<{pattern: string, slots: string[]}>}
 */
export const TEMPLATES = Object.freeze([
  // ---- video ------------------------------------------------------------
  { pattern: "https://www.youtube.com/watch?v={0}", slots: ["b64"] },
  { pattern: "https://youtu.be/{0}", slots: ["b64"] },
  { pattern: "https://m.youtube.com/watch?v={0}", slots: ["b64"] },
  { pattern: "https://www.youtube.com/shorts/{0}", slots: ["b64"] },

  // ---- social -----------------------------------------------------------
  { pattern: "https://twitter.com/{0}/status/{1}", slots: ["slug", "dec"] },
  { pattern: "https://x.com/{0}/status/{1}", slots: ["slug", "dec"] },
  { pattern: "https://www.facebook.com/{0}/posts/{1}", slots: ["slug", "dec"] },
  { pattern: "https://www.instagram.com/p/{0}/", slots: ["b64"] },
  { pattern: "https://www.instagram.com/reel/{0}/", slots: ["b64"] },
  { pattern: "https://www.reddit.com/r/{0}/comments/{1}/", slots: ["slug", "slug"] },
  { pattern: "https://old.reddit.com/r/{0}/comments/{1}/", slots: ["slug", "slug"] },
  { pattern: "https://www.tiktok.com/@{0}/video/{1}", slots: ["slug", "dec"] },
  { pattern: "https://bsky.app/profile/{0}/post/{1}", slots: ["slug", "b64"] },
  { pattern: "https://www.linkedin.com/posts/{0}", slots: ["slug"] },

  // ---- images -----------------------------------------------------------
  { pattern: "https://i.imgur.com/{0}.jpg", slots: ["b64"] },
  { pattern: "https://i.imgur.com/{0}.png", slots: ["b64"] },
  { pattern: "https://imgur.com/a/{0}", slots: ["b64"] },
  { pattern: "https://i.redd.it/{0}.jpg", slots: ["slug"] },
  { pattern: "https://i.redd.it/{0}.png", slots: ["slug"] },
  { pattern: "https://pbs.twimg.com/media/{0}.jpg", slots: ["b64"] },

  // ---- shopping ---------------------------------------------------------
  { pattern: "https://www.amazon.com/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.co.uk/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.de/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.com/gp/product/{0}", slots: ["up36"] },
  { pattern: "https://www.ebay.com/itm/{0}", slots: ["dec"] },
  { pattern: "https://www.etsy.com/listing/{0}/{1}", slots: ["dec", "slug"] },

  // ---- reference and code ----------------------------------------------
  { pattern: "https://github.com/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://github.com/{0}/{1}/issues/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://github.com/{0}/{1}/pull/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://en.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://arxiv.org/abs/{0}", slots: ["slug"] },
  { pattern: "https://doi.org/10.{0}", slots: ["slug"] },
  { pattern: "https://open.spotify.com/track/{0}", slots: ["b64"] },
  { pattern: "https://open.spotify.com/album/{0}", slots: ["b64"] },
  { pattern: "https://news.ycombinator.com/item?id={0}", slots: ["dec"] },
  { pattern: "https://stackoverflow.com/questions/{0}/{1}", slots: ["dec", "slug"] },

  // ---- v7 additions ------------------------------------------------------
  // The timestamped YouTube share — the most-shared link shape there is.
  { pattern: "https://www.youtube.com/watch?v={0}&t={1}s", slots: ["b64", "dec"] },
  { pattern: "https://www.youtube.com/watch?v={0}&t={1}", slots: ["b64", "dec"] },
  { pattern: "https://youtu.be/{0}?t={1}s", slots: ["b64", "dec"] },
  { pattern: "https://youtu.be/{0}?t={1}", slots: ["b64", "dec"] },
  // Real article names carry capitals, parentheses and percent-escapes; the
  // old slug slot silently missed nearly all of them.
  { pattern: "https://de.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://fr.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://es.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://ru.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://ja.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://it.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://pl.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://nl.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://pt.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://zh.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://github.com/{0}/{1}/blob/{2}", slots: ["slug", "slug", "text"] },
  { pattern: "https://github.com/{0}/{1}/tree/{2}", slots: ["slug", "slug", "text"] },
  { pattern: "https://github.com/{0}/{1}/releases/tag/{2}", slots: ["slug", "slug", "text"] },
  { pattern: "https://www.reddit.com/r/{0}/comments/{1}/{2}/", slots: ["slug", "slug", "text"] },
  { pattern: "https://old.reddit.com/r/{0}/comments/{1}/{2}/", slots: ["slug", "slug", "text"] },
  { pattern: "https://stackoverflow.com/a/{0}", slots: ["dec"] },
  { pattern: "https://stackoverflow.com/q/{0}", slots: ["dec"] },
  { pattern: "https://vimeo.com/{0}", slots: ["dec"] },
  { pattern: "https://www.twitch.tv/videos/{0}", slots: ["dec"] },
  { pattern: "https://open.spotify.com/episode/{0}", slots: ["b64"] },
  { pattern: "https://open.spotify.com/playlist/{0}", slots: ["b64"] },
  { pattern: "https://commons.wikimedia.org/wiki/File:{0}", slots: ["text"] },
]);

/** Longest slot value a template will hold; the length field is 6 bits. */
export const MAX_SLOT = 63;

/**
 * Pre-compiled matchers: a regex per template, plus the literal pieces needed
 * to rebuild the URL from captured values.
 */
export const COMPILED = TEMPLATES.map(({ pattern, slots }, index) => {
  const literals = pattern.split(/\{\d\}/);
  if (literals.length - 1 !== slots.length) {
    // Thrown at module evaluation: a malformed table must fail the build and
    // the test run, not one unlucky decode.
    throw new ClentError(`template "${pattern}" has ${literals.length - 1} slots, ` +
      `declared ${slots.length}`);
  }
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = literals.map(escape).join("(.+?)").replace(/\(\.\+\?\)$/, "(.+)");
  return {
    index,
    pattern,
    slots,
    literals,
    host: pattern.slice("https://".length, pattern.indexOf("/", "https://".length)),
    match: new RegExp(`^${source}$`),
  };
});

/**
 * Templates grouped by the host they apply to.
 *
 * Without this, encoding any URL means running every template's regex. With
 * it, a URL that is not on a templated host does no regex work at all, which
 * is the overwhelming majority of them.
 *
 * @type {ReadonlyMap<string, typeof COMPILED>}
 */
export const BY_HOST = (() => {
  /** @type {Map<string, typeof COMPILED>} */
  const byHost = new Map();
  for (const template of COMPILED) {
    if (!byHost.has(template.host)) byHost.set(template.host, []);
    byHost.get(template.host).push(template);
  }
  return byHost;
})();

/**
 * Rebuild a URL from a template index and its slot values.
 * @param {number} index
 * @param {string[]} values
 * @returns {string}
 */
export function fill(index, values) {
  const template = COMPILED[index];
  if (!template) throw new ClentError(`This link uses template ${index}, which this page does not have.`);
  let out = template.literals[0];
  for (let i = 0; i < values.length; i++) out += values[i] + template.literals[i + 1];
  return out;
}

/**
 * Index of each charset's characters, for encoding.
 * @type {Record<string, {set: {chars: string, bits: number}, index: Map<string, number>}>}
 */
export const CHARSET_INDEX = Object.fromEntries(Object.entries(CHARSETS).map(([name, set]) => [
  name, { set, index: new Map([...set.chars].map((c, i) => [c, i])) },
]));

/**
 * Try to express a URL as one of the templates.
 *
 * Returns null unless the captured values round-trip: every value has to fit
 * its declared alphabet, be short enough for the 6-bit length field, and
 * substituting them back must reproduce the URL exactly. Approximate matches
 * are worse than useless here — they would resolve to a different page.
 *
 * @param {URL} url
 * @returns {{index: number, values: string[], bits: number}|null}
 */
export function asTemplate(url) {
  // Only templates for this exact host can match, so most URLs do no regex
  // work at all.
  if (url.protocol !== "https:") return null;
  const family = BY_HOST.get(url.host);
  if (!family) return null;

  const href = url.href;
  let best = null;

  for (const template of family) {
    const index = template.index;
    const found = template.match.exec(href);
    if (!found) continue;

    const values = found.slice(1);
    let bits = 0;
    let usable = true;

    for (let slot = 0; slot < values.length; slot++) {
      const value = values[slot];
      if (!value) { usable = false; break; }

      if (template.slots[slot] === "text") {
        // Huffman-coded and END-terminated: any value works, at text cost.
        if (value.length > 255) { usable = false; break; }
        bits += textBits(slotEncoder.encode(value));
        continue;
      }

      const charset = CHARSET_INDEX[template.slots[slot]];
      if (value.length > MAX_SLOT) { usable = false; break; }
      for (const character of value) {
        if (!charset.index.has(character)) { usable = false; break; }
      }
      if (!usable) break;
      bits += 6 + value.length * charset.set.bits;
    }
    if (!usable) continue;

    // The guard that makes this safe to use at all.
    if (fill(index, values) !== href) continue;

    if (!best || bits < best.bits) best = { index, values, bits };
  }
  return best;
}

/**
 * Write a template's index and slot values into an open bit stream. The
 * caller writes the 6-bit header first; this writes everything after it.
 *
 * @param {import("./bits.js").BitWriter} w
 * @param {{index: number, values: string[]}} template
 * @returns {string} the finished payload
 */
export function writeTemplate(w, { index, values }) {
  w.push(index, 8);
  const slots = COMPILED[index].slots;
  for (let slot = 0; slot < values.length; slot++) {
    if (slots[slot] === "text") {
      emitText(w, slotEncoder.encode(values[slot]));
      continue;
    }
    const charset = CHARSET_INDEX[slots[slot]];
    w.push(values[slot].length, 6);
    for (const character of values[slot]) {
      w.push(charset.index.get(character), charset.set.bits);
    }
  }
  return w.finish();
}

/**
 * Read a template payload (after the header) back into the URL it encodes.
 *
 * @param {import("./bits.js").BitReader} reader
 * @returns {string} the rebuilt URL
 */
export function readTemplate(reader) {
  const index = reader.read(8);
  const template = COMPILED[index];
  if (!template) throw new ClentError("This link uses a newer template than this page has.");

  const values = [];
  for (const name of template.slots) {
    if (name === "text") {
      const value = decodeText(reader);
      if (!value) throw new ClentError("This link is damaged — an empty field.");
      values.push(value);
      continue;
    }
    const charset = CHARSETS[name];
    const length = reader.read(6);
    if (length === 0) throw new ClentError("This link is damaged — an empty field.");
    let value = "";
    for (let i = 0; i < length; i++) {
      const at = reader.read(charset.bits);
      const character = charset.chars[at];
      if (character === undefined) throw new ClentError("This link is damaged.");
      value += character;
    }
    values.push(value);
  }
  return fill(index, values);
}
