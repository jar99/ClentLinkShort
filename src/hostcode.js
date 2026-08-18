/**
 * The host code: canonical Huffman lengths over hostname bytes plus END,
 * ESC and one TERMINAL symbol per registrable suffix, mined from the corpus
 * by tools/mine-host.mjs.
 *
 * This is how an arbitrary domain stays cheap without a dictionary entry:
 * the name part is spelled in a code tuned to hostname letters, and the
 * suffix — ".com" for two in five unknown hosts — is one short symbol that
 * also ends the field. A host whose suffix is not listed ends with the plain
 * END symbol instead; nothing needs this table to grow per domain.
 *
 * Symbols 0..255 are bytes; 256 = END, 257 = ESC (a raw 8-bit byte
 * follows), 258+k = "append SUFFIXES[k], then end", and past those one
 * symbol per HOST_TOKEN — "blog.", "mail." and friends cost a few bits
 * instead of being spelled. Codes are canonical: assigned by ascending
 * length, ties by ascending symbol, so the lengths array IS the whole code.
 *
 * Beta: re-mining replaces these tables and invalidates existing links;
 * after 1.0 this file is frozen by test/compat.test.js.
 *
 * @module hostcode
 */

/** Code length per symbol (one hex digit each); 256 END, 257 ESC, 258+k terminals. */
export const HOST_CODE_LENGTHS = Object.freeze([..."00000000000000000000000000000000000000f000000760a99aaaaaaaff0f000000000000000000000000000000000f04655466648655445944557786800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000009ffedfcefa5fedfebeefefddcbdffededfffeeefecfdcffedfdedecdeadffffefefdefdfecffeffecddffcffdfe5bbebf8e8dfcefbfbfdefceeebccdcbc9cfcccebfcfecdeefbadebbeeefffcdeacfeeebdce9fcfefefeeddedccdfb9aabbbbbfdbdbfffbbbfbfa9aaaab99bacfbc999aa99f9d99cbde9ceac99a9e"].map((c) => parseInt(c, 16)));

export const HOST_END = 256, HOST_ESC = 257, SUFFIX_BASE = 258;

/**
 * Suffix per terminal symbol, longest first so greedy matching is safe.
 * @type {readonly string[]}
 */
export const SUFFIXES = Object.freeze([
  ".posterous.com", ".wikipedia.org", ".wordpress.com", ".bearblog.dev", ".blogspot.com",
  ".linkedin.com", ".stanford.edu", ".substack.com", ".fandom.com", ".github.com",
  ".google.com", ".medium.com", ".tumblr.com", ".vercel.app", ".github.io",
  ".yahoo.com", ".nasa.gov", ".free.fr", ".mit.edu", ".network", ".casino",
  ".com.ar", ".com.au", ".com.br", ".com.cn", ".com.co", ".com.hk", ".com.mx",
  ".com.tr", ".com.tw", ".com.ua", ".com.vn", ".edu.au", ".edu.cn", ".gov.au",
  ".gov.br", ".gov.cn", ".gov.in", ".gov.uk", ".online", ".org.br", ".org.uk",
  ".social", ".ac.id", ".ac.in", ".ac.jp", ".ac.uk", ".click", ".cloud", ".co.id",
  ".co.il", ".co.in", ".co.jp", ".co.kr", ".co.nz", ".co.uk", ".co.za", ".games",
  ".go.jp", ".go.kr", ".lg.jp", ".media", ".ne.jp", ".or.jp", ".or.kr", ".space",
  ".store", ".world", ".blog", ".buzz", ".club", ".info", ".life", ".link",
  ".live", ".mobi", ".name", ".news", ".shop", ".site", ".tech", ".work",
  ".zone", ".app", ".art", ".bet", ".biz", ".cat", ".cfd", ".com", ".dev",
  ".edu", ".fun", ".gov", ".lol", ".net", ".one", ".org", ".pro", ".run",
  ".top", ".vip", ".win", ".xyz", ".ae", ".ai", ".ar", ".at", ".au", ".bd",
  ".be", ".bg", ".br", ".by", ".ca", ".cc", ".ch", ".cl", ".cn", ".co", ".cz",
  ".de", ".dk", ".ee", ".es", ".eu", ".fi", ".fm", ".fr", ".gg", ".gr", ".hk",
  ".hr", ".hu", ".id", ".ie", ".il", ".im", ".in", ".io", ".ir", ".is", ".it",
  ".jp", ".kr", ".kz", ".lt", ".lv", ".ma", ".md", ".me", ".mx", ".my", ".nl",
  ".no", ".nz", ".pe", ".ph", ".pk", ".pl", ".pt", ".ro", ".rs", ".ru", ".sa",
  ".se", ".sg", ".sh", ".si", ".sk", ".su", ".th", ".to", ".tr", ".tv", ".tw",
  ".ua", ".uk", ".us", ".vn", ".za"
]);

/** First host-token symbol; token k lives at HOST_TOKEN_BASE + k. */
export const HOST_TOKEN_BASE = 439;

/**
 * Common host fragments as their own symbols, indexed as on the wire.
 * @type {readonly string[]}
 */
export const HOST_TOKENS = Object.freeze([
  "online", "alpha", "blog.", "craft", "cyber", "pedia", "terra", "villa",
  "world", "ague", "allo", "ball", "ders", "digi", "emon", "emor", "ends",
  "game", "gate", "ight", "inec", "itch", "lder", "lege", "memo", "mine",
  "news", "otte", "poke", "port", "roll", "star", "tech", "tion", "tter",
  "arv", "che", "cro", "dis", "eld", "ent", "fal", "gen", "har", "ing", "kem",
  "lea", "lls", "lou", "mar", "ory", "out", "pot", "rry", "rsc", "rve", "rwa",
  "ryp", "scr", "the", "vel", "ver", "war", "ypo"
]);
