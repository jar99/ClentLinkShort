/**
 * Message lookup for the page.
 *
 * There is no server to negotiate with and nothing may be stored, so the
 * language comes from the browser's own preference list and can be changed for
 * the session with the picker. Catalogues are bundled rather than fetched:
 * the page is one file that has to work offline and under a CSP that forbids
 * every network request, so a locale is a module, not a download.
 *
 * English is the fallback for any key a translation has not reached yet, which
 * is what makes a partial translation useful instead of a page full of holes.
 *
 * @module i18n
 */

import { MESSAGES_EN } from "./messages/en.js";
import { MESSAGES_ES } from "./messages/es.js";

/**
 * Every catalogue the build includes. Adding a language is a file in
 * src/messages exporting MESSAGES_<CODE>, plus an import and a line here.
 * Nothing else in the app needs to know — see README.
 * @type {Record<string, Record<string, string>>}
 */
export const CATALOGUES = { en: MESSAGES_EN, es: MESSAGES_ES };

/** Languages written right to left, so the document can say so. */
const RTL = new Set(["ar", "fa", "he", "ur", "ps", "sd", "yi"]);

let active = "en";

/** The base language of a tag: "pt-BR" -> "pt". */
const base = (tag) => String(tag).toLowerCase().split("-")[0];

/**
 * Pick the best available catalogue for a list of preferences.
 * Exact match wins over base match, and English is the floor.
 * @param {readonly string[]} preferred
 * @returns {string}
 */
export function choose(preferred = []) {
  const have = Object.keys(CATALOGUES);
  for (const tag of preferred) {
    const wanted = String(tag).toLowerCase();
    const exact = have.find((code) => code.toLowerCase() === wanted);
    if (exact) return exact;
    const loose = have.find((code) => base(code) === base(wanted));
    if (loose) return loose;
  }
  return "en";
}

/** Switch language for this session. Nothing is persisted; nothing is stored. */
export function setLanguage(code) {
  active = CATALOGUES[code] ? code : "en";
  if (typeof document !== "undefined") {
    document.documentElement.lang = active;
    document.documentElement.dir = RTL.has(base(active)) ? "rtl" : "ltr";
  }
  return active;
}

export const language = () => active;

/**
 * Is this key translatable at all? Callers that carry their own English —
 * risk.js does — need to tell "no catalogue entry" apart from "entry is the
 * key", because t() cannot.
 * @param {string} key
 */
export const has = (key) =>
  Object.hasOwn(MESSAGES_EN, key) || Object.hasOwn(CATALOGUES[active] ?? {}, key);

/** Fill {placeholders} from a plain object. */
const format = (text, values) =>
  values ? text.replace(/\{(\w+)\}/g, (whole, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : whole) : text;

/**
 * Look a message up, falling back to English and finally to the key itself —
 * a visible key is a bug report, which beats an empty element.
 * @param {string} key
 * @param {Record<string, string|number>} [values]
 * @returns {string}
 */
export function t(key, values) {
  // hasOwn, not plain access: `toString` and friends are on every object, so
  // a key like that would resolve to a function and format() would call
  // .replace on it. has() below uses the same test; they have to agree.
  const catalogue = CATALOGUES[active];
  const text = catalogue && Object.hasOwn(catalogue, key)
    ? catalogue[key]
    : Object.hasOwn(MESSAGES_EN, key) ? MESSAGES_EN[key] : key;
  return format(text, values);
}

/**
 * Attributes a catalogue is allowed to set.
 *
 * data-t-attr turns a translated string into a DOM attribute. The attribute
 * name comes from this repository's markup, but the value comes from a
 * catalogue — which is a file someone contributes, and adding a language is
 * meant to be exactly that. Without this list, `data-t-attr="href:some.key"`
 * would let a translation supply a javascript: URL. These four carry text and
 * nothing else, so the worst a hostile translation can do through them is lie.
 */
const TRANSLATABLE_ATTRIBUTES = new Set(["placeholder", "aria-label", "title", "alt"]);

/**
 * Apply the active catalogue to the document: every [data-t] gets its text,
 * and data-t-attr="placeholder:key" forms set attributes.
 */
export function translate(root = document) {
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
      root.querySelectorAll("[data-t]"))) {
    el.textContent = t(String(el.dataset.t));
  }
  for (const el of /** @type {NodeListOf<HTMLElement>} */ (
      root.querySelectorAll("[data-t-attr]"))) {
    for (const pair of String(el.dataset.tAttr).split(",")) {
      const [attr, key] = pair.split(":");
      if (!attr || !key) continue;
      const name = attr.trim();
      if (!TRANSLATABLE_ATTRIBUTES.has(name)) continue;
      el.setAttribute(name, t(key.trim()));
    }
  }
}
