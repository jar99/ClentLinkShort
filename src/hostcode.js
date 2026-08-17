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
export const HOST_CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000000000f0000f76099999aaaaaf000000000000000000000000000000000000f04655466548655445954557676700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008fecdfdfeadfdfdbdebfdeeffdcbcefefedddeedffefddddffeeddeffcffdeeccfdfdedcfdebebcdd9dfededfeddeeeffdebedfeeddebd5a9eace8e7ddefcaecfbddebcbdbbc8bdbbaeaebeeadedbaceaaeeeeceeaaeedeaccd8aeddedfcecdcdfdccabbbbcabbabbbbcfb0d9bbbabbbbaa9aaaaa99aaad99a9a9faa9ab99aaaaa"].map((c) => parseInt(c, 16)));

export const HOST_END = 256, HOST_ESC = 257, SUFFIX_BASE = 258;

/**
 * Suffix per terminal symbol, longest first so greedy matching is safe.
 * @type {readonly string[]}
 */
export const SUFFIXES = Object.freeze([
  ".sourceforge.net", ".wikipedia.org", ".wordpress.com", ".bearblog.dev",
  ".blogspot.com", ".in-addr.arpa", ".stanford.edu", ".substack.com", ".harvard.edu",
  ".netlify.app", ".google.com", ".medium.com", ".vercel.app", ".github.io",
  ".yahoo.com", ".narod.ru", ".nasa.gov", ".digital", ".free.fr", ".gouv.fr",
  ".mit.edu", ".network", ".casino", ".com.ar", ".com.au", ".com.br", ".com.cn",
  ".com.co", ".com.hk", ".com.mx", ".com.my", ".com.pl", ".com.tr", ".com.tw",
  ".com.ua", ".com.vn", ".edu.au", ".edu.cn", ".edu.pl", ".edu.tr", ".edu.tw",
  ".gob.mx", ".gov.au", ".gov.br", ".gov.cn", ".gov.in", ".gov.my", ".gov.pl",
  ".gov.tr", ".gov.tw", ".gov.ua", ".gov.uk", ".gov.vn", ".net.au", ".nic.in",
  ".online", ".org.au", ".org.br", ".org.il", ".org.tr", ".org.ua", ".org.uk",
  ".social", ".ac.id", ".ac.il", ".ac.in", ".ac.jp", ".ac.kr", ".ac.th", ".ac.uk",
  ".click", ".cloud", ".co.id", ".co.il", ".co.in", ".co.jp", ".co.kr", ".co.nz",
  ".co.th", ".co.uk", ".co.za", ".gc.ca", ".go.id", ".go.jp", ".go.kr", ".go.th",
  ".lg.jp", ".media", ".ne.jp", ".or.jp", ".or.kr", ".space", ".store", ".world",
  ".arpa", ".blog", ".club", ".info", ".link", ".live", ".mobi", ".news",
  ".shop", ".site", ".tech", ".work", ".app", ".biz", ".com", ".dev", ".edu",
  ".fun", ".gov", ".int", ".mil", ".net", ".one", ".org", ".pro", ".top",
  ".vip", ".xxx", ".xyz", ".ai", ".ar", ".at", ".au", ".be", ".bg", ".br",
  ".by", ".ca", ".cc", ".ch", ".cl", ".cn", ".co", ".cz", ".de", ".dk", ".ee",
  ".es", ".eu", ".fi", ".fm", ".fr", ".gg", ".gr", ".hk", ".hr", ".hu", ".id",
  ".ie", ".il", ".in", ".io", ".ir", ".is", ".it", ".jp", ".kr", ".kz", ".lt",
  ".lv", ".me", ".mx", ".my", ".nl", ".no", ".nz", ".pe", ".ph", ".pk", ".pl",
  ".pt", ".ro", ".rs", ".ru", ".se", ".sg", ".sh", ".sk", ".th", ".to", ".tr",
  ".tv", ".tw", ".ua", ".uk", ".us", ".vn", ".za"
]);

/** First host-token symbol; token k lives at HOST_TOKEN_BASE + k. */
export const HOST_TOKEN_BASE = 450;

/**
 * Common host fragments as their own symbols, indexed as on the wire.
 * @type {readonly string[]}
 */
export const HOST_TOKENS = Object.freeze([
  "library", "science", ".googl", "google", "online", "cloud", "imedi", "media",
  "music", "tools", "world", ".gov", ".wik", "arch", "atio", "book", "brit",
  "erve", "ews.", "game", "ikim", "life", "news", "port", "serv", "spor",
  "tech", "time", "tion", "wiki", "work", "age", "all", "and", "art", "ata",
  "ber", "blo", "cat", "com", "ent", "ers", "fli", "for", "gue", "ing", "ist",
  "ive", "log", "mar", "net", "ogu", "per", "pro", "sta", "str", "tal", "ter",
  "the", "tor", "tra", "tur", "ver", "web"
]);
