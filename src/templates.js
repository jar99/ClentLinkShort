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
 * Correctness rule, enforced at encode time in clent.js: a template is only
 * used if substituting the captured values back into the pattern reproduces
 * the original URL character for character. Anything else would be a silent
 * redirect to the wrong place, which is the one failure that must never ship.
 */

/**
 * Slot alphabets. `bits` is what one character costs; a character outside the
 * alphabet disqualifies the template for that URL.
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
  { pattern: "https://en.wikipedia.org/wiki/{0}", slots: ["slug"] },
  { pattern: "https://arxiv.org/abs/{0}", slots: ["slug"] },
  { pattern: "https://doi.org/10.{0}", slots: ["slug"] },
  { pattern: "https://open.spotify.com/track/{0}", slots: ["b64"] },
  { pattern: "https://open.spotify.com/album/{0}", slots: ["b64"] },
  { pattern: "https://news.ycombinator.com/item?id={0}", slots: ["dec"] },
  { pattern: "https://stackoverflow.com/questions/{0}/{1}", slots: ["dec", "slug"] },
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
    throw new Error(`template "${pattern}" has ${literals.length - 1} slots, ` +
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
export const BY_HOST = new Map();
for (const template of COMPILED) {
  if (!BY_HOST.has(template.host)) BY_HOST.set(template.host, []);
  BY_HOST.get(template.host).push(template);
}

/**
 * Rebuild a URL from a template index and its slot values.
 * @param {number} index
 * @param {string[]} values
 * @returns {string}
 */
export function fill(index, values) {
  const template = COMPILED[index];
  if (!template) throw new Error(`no template ${index}`);
  let out = template.literals[0];
  for (let i = 0; i < values.length; i++) out += values[i] + template.literals[i + 1];
  return out;
}
