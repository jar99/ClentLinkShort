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
export const HOST_CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000000000000f00760a99aaaaaaaf000000000000000000000000000000000000f04655466648656545944457786800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008fffddcda5bdeebdfddcbdfefdeeefefeefcfdceffdededecdeadfedeedeecfeeeedddbde5bafbe8e7dfcefbfbececeefbccdcbc9cfcccfbfbeecdeedbadebbdeffceeacefeebdce9cfefefeeddecccfdfcbbaabab9ebbbfaba9a9abe9aabbafaa99c9aa9c9fd99999d9becece999aa9ae"].map((c) => parseInt(c, 16)));

export const HOST_END = 256, HOST_ESC = 257, SUFFIX_BASE = 258;

/**
 * Suffix per terminal symbol, longest first so greedy matching is safe.
 * @type {readonly string[]}
 */
export const SUFFIXES = Object.freeze([
  ".sourceforge.net", ".posterous.com", ".wikipedia.org", ".wordpress.com",
  ".blogspot.com", ".linkedin.com", ".substack.com", ".fandom.com", ".google.com",
  ".medium.com", ".tumblr.com", ".vercel.app", ".github.io", ".nasa.gov",
  ".free.fr", ".casino", ".com.ar", ".com.au", ".com.br", ".com.cn", ".com.co",
  ".com.mx", ".com.pl", ".com.tr", ".com.tw", ".com.ua", ".edu.cn", ".gov.au",
  ".gov.br", ".gov.cn", ".gov.in", ".gov.uk", ".net.br", ".online", ".org.au",
  ".org.uk", ".social", ".ac.id", ".ac.in", ".ac.jp", ".ac.uk", ".click",
  ".cloud", ".co.id", ".co.il", ".co.in", ".co.jp", ".co.kr", ".co.nz", ".co.uk",
  ".co.za", ".ne.jp", ".or.jp", ".space", ".store", ".world", ".blog", ".buzz",
  ".club", ".info", ".life", ".link", ".live", ".mobi", ".news", ".shop",
  ".site", ".tech", ".app", ".biz", ".cfd", ".com", ".dev", ".edu", ".fun",
  ".gov", ".lol", ".net", ".one", ".org", ".pro", ".run", ".top", ".vip",
  ".win", ".xyz", ".ae", ".ai", ".ar", ".at", ".au", ".be", ".bg", ".br",
  ".by", ".ca", ".cc", ".ch", ".cl", ".cn", ".co", ".cz", ".de", ".dk", ".ee",
  ".es", ".eu", ".fi", ".fm", ".fr", ".gg", ".gr", ".hk", ".hr", ".hu", ".id",
  ".ie", ".il", ".im", ".in", ".io", ".ir", ".is", ".it", ".jp", ".kr", ".kz",
  ".lt", ".lv", ".me", ".mx", ".my", ".nl", ".no", ".nz", ".pe", ".ph", ".pk",
  ".pl", ".pt", ".ro", ".rs", ".ru", ".se", ".sg", ".sh", ".si", ".sk", ".su",
  ".th", ".to", ".tr", ".tv", ".tw", ".ua", ".uk", ".us", ".uy", ".vn", ".za"
]);

/** First host-token symbol; token k lives at HOST_TOKEN_BASE + k. */
export const HOST_TOKEN_BASE = 418;

/**
 * Common host fragments as their own symbols, indexed as on the wire.
 * @type {readonly string[]}
 */
export const HOST_TOKENS = Object.freeze([
  "science", "google", "online", "blog.", "craft", "cyber", "disco", "world",
  "alph", "ders", "digi", "edia", "game", "lder", "lege", "medi", "mine",
  "news", "omat", "otte", "poke", "port", "roll", "star", "tech", "tion",
  "tter", "wiki", "all", "arv", "che", "com", "cro", "eld", "emo", "ent",
  "fal", "gen", "har", "her", "ing", "kem", "llo", "lls", "lou", "mar", "mem",
  "mon", "mor", "ory", "out", "pha", "pot", "rry", "rve", "rwa", "ryp", "the",
  "vel", "ver", "vil", "war", "web", "ypo"
]);
