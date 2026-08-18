/**
 * Internationalised names: telling a Japanese domain from a homograph.
 *
 * A redirector must open any valid, safe URL, and an internationalised domain
 * is both. Refusing to follow every `xn--` name would turn "we support the
 * web" into "we support the Latin web" — 1,539 of the 4.3M corpus URLs are
 * ordinary Japanese, Chinese and emoji domains.
 *
 * The attack that punycode enables is narrower than punycode itself: a label
 * that MIXES scripts so that non-Latin characters can pose as Latin ones,
 * like the Cyrillic а in "pаypal". Single-script labels are not that. So the
 * name is decoded and its scripts are counted, following the spirit of
 * UTS-39: one script is fine, and the combinations real languages need —
 * Japanese, Korean, Chinese — are fine. Anything else mixing is the shape
 * worth stopping for.
 *
 * The limit, stated plainly: a whole-script confusable, every character
 * Cyrillic and the word still reading as "paypal", is not mixed and so is not
 * caught here. Catching that needs a confusables table far larger than this
 * page, and it is a different problem from the one this solves.
 *
 * @module idn
 */

/* -------------------------------------------------------------------------- *
 * Punycode decoding (RFC 3492), just enough to see the characters
 * -------------------------------------------------------------------------- */

const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700;
const INITIAL_BIAS = 72, INITIAL_N = 128;

const digitOf = (code) => {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26; // 0-9
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;      // A-Z
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;      // a-z
  return BASE;
};

function adapt(delta, count, first) {
  let d = first ? Math.floor(delta / DAMP) : delta >> 1;
  d += Math.floor(d / count);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) >> 1) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/**
 * Decode one punycode label (without its "xn--" prefix).
 * @param {string} input
 * @returns {string|null} null when the label is not valid punycode
 */
export function decodePunycode(input) {
  const delimiter = input.lastIndexOf("-");
  const output = [];
  for (let i = 0; i < (delimiter > 0 ? delimiter : 0); i++) {
    const code = input.charCodeAt(i);
    if (code > 0x7f) return null;
    output.push(code);
  }

  let n = INITIAL_N, bias = INITIAL_BIAS, i = 0;
  for (let at = delimiter > 0 ? delimiter + 1 : 0; at < input.length; ) {
    const previous = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (at >= input.length) return null;
      const digit = digitOf(input.charCodeAt(at++));
      if (digit >= BASE) return null;
      // Overflow here would silently decode to the wrong name, which is the
      // one outcome a check like this must never produce.
      if (digit > Math.floor((0x7fffffff - i) / w)) return null;
      i += digit * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digit < t) break;
      if (w > Math.floor(0x7fffffff / (BASE - t))) return null;
      w *= BASE - t;
    }
    bias = adapt(i - previous, output.length + 1, previous === 0);
    if (Math.floor(i / (output.length + 1)) > 0x7fffffff - n) return null;
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n < 0 || n > 0x10ffff) return null;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/* -------------------------------------------------------------------------- *
 * Which scripts a label draws on
 * -------------------------------------------------------------------------- */

/**
 * Scripts that carry Latin lookalikes, plus the ones real languages combine.
 * Everything not listed counts as "other": still a script, still countable,
 * but no attempt is made to name it.
 */
/** @type {ReadonlyArray<[string, RegExp]>} */
const SCRIPTS = [
  ["Latin", /\p{Script=Latin}/u],
  ["Cyrillic", /\p{Script=Cyrillic}/u],
  ["Greek", /\p{Script=Greek}/u],
  ["Han", /\p{Script=Han}/u],
  ["Hiragana", /\p{Script=Hiragana}/u],
  ["Katakana", /\p{Script=Katakana}/u],
  ["Hangul", /\p{Script=Hangul}/u],
  ["Bopomofo", /\p{Script=Bopomofo}/u],
  ["Arabic", /\p{Script=Arabic}/u],
  ["Hebrew", /\p{Script=Hebrew}/u],
  ["Thai", /\p{Script=Thai}/u],
  ["Devanagari", /\p{Script=Devanagari}/u],
];

/** Combinations a real language needs, so they are not "mixed" in the bad sense. */
/** @type {ReadonlyArray<string[]>} */
const COHERENT = [
  ["Latin", "Han", "Hiragana", "Katakana"], // Japanese
  ["Latin", "Han", "Hangul"],               // Korean
  ["Latin", "Han", "Bopomofo"],             // Chinese
];

/**
 * Does this decoded label mix scripts in a way no language does?
 *
 * Digits, hyphens, punctuation and emoji are script-neutral and ignored: an
 * emoji domain draws on no script at all and is not suspicious for it.
 *
 * @param {string} text a decoded label
 * @returns {boolean}
 */
export function mixesScripts(text) {
  const seen = new Set();
  for (const character of text) {
    for (const [name, pattern] of SCRIPTS) {
      if (pattern.test(character)) {
        seen.add(name);
        break;
      }
    }
  }
  if (seen.size <= 1) return false;
  return !COHERENT.some((allowed) =>
    [...seen].every((script) => allowed.includes(script)));
}

/**
 * Is this hostname deceptive rather than merely international?
 * @param {string} hostname as the URL parser gives it, so punycode-encoded
 * @returns {boolean}
 */
export function deceptiveIdn(hostname) {
  for (const label of hostname.split(".")) {
    if (!label.startsWith("xn--")) continue;
    const decoded = decodePunycode(label.slice(4));
    // Undecodable is its own kind of wrong: a label claiming to be
    // internationalised that is not, which nothing legitimate produces.
    if (decoded === null || mixesScripts(decoded)) return true;
  }
  return false;
}
