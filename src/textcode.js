/**
 * The text-mode code: canonical Huffman lengths over body bytes, the END
 * and ESC controls, and ONE SYMBOL PER DICTIONARY TOKEN, all mined from the
 * corpus by tools/mine-text.mjs.
 *
 * Tokens as first-class symbols is the load-bearing choice: a frequent run
 * like "articles/" costs its measured frequency — a handful of bits — while
 * a rare token pays for itself, and no fixed index tax sits on any of them.
 *
 * Symbols 0..255 are bytes (length 0 = written via ESC); 256 = END,
 * 257 = ESC (a raw 8-bit byte follows), 258+k = "append TOKENS[k]". Codes
 * are canonical: assigned by ascending length, ties by ascending symbol, so
 * the lengths array IS the whole code.
 *
 * Beta: re-mining replaces these tables and invalidates existing links.
 * Once stability is declared, this file is frozen by test/compat.test.js
 * and future formats ride the VERSION_ESCAPE envelope instead.
 *
 * @module textcode
 */

/** Code length per symbol (one hex digit each); 256 END, 257 ESC, 258+k tokens. */
export const CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000c0cf57f99f9956566567777669e0708d7878889a9ab99999b989aaacbb0000505666576659766656a555678879000b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005fffcacabd9caacfdfddd9aaecccccfddce988b99f9f99999a9abdabbbabbbbbcccbccccccdcddddddddcdededdd99c9999e9ad9aaaaaaaaacaaaaabababbcabccaaabbcaabababbbbbbabbbbcbbabbbbbbbbbbbbbbcbbbbccbcbbcbcabccabcbcbbdbbbbbbbcbbbbccccbbccbdcccccaacccccbccbccccccdccccdccccccccbcc"].map((c) => parseInt(c, 16)));

export const SYM_END = 256, SYM_ESC = 257, TOKEN_BASE = 258;

/**
 * The substring dictionary, indexed as on the wire (symbol TOKEN_BASE + k).
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  "articles/", "index.php", "/cgi-bin/", "/article", "content", "/2026/0",
  "/index.", "archive", "source", "search", "/blog/", "/searc", "2026-0",
  "posts/", "-with-", "detail", "claude", "system", "google", "image", ".php?",
  "/news", "news/", "story", "world", "/post", "agent", "publi", "ublic",
  "type=", "build", "-2026", "glish", "wiki", ".htm", "/wik", "html", ".jpg",
  "comm", "edia", "info", "iki/", "tion", "pedi", "/com", "_con", "medi",
  "ing-", "inal", "ment", "the-", "ogra", ".asp", ".pdf", "-the", "atch",
  "auto", "/201", "page", "-to-", "view", "-of-", "ture", "-ai-", "play",
  "port", "data", "ject", "tech", "work", "open", "-is-", "/doc", "from",
  "down", "News", "what", "tive", "lock", "load", "ight", "ener", "-new",
  "ing/", "new-", "/ai-", "peci", "spec", "/05/", "/01/", "ons", "mon", "mpa",
  "org", "ign", "ile", "cam", "amp", "_de", "id=", "rig", "ori", "and", "man",
  "que", "che", "200", "ter", "ist", "all", "for", "ine", "ver", "nce", "pro",
  "-co", "-in", "al-", "res", "es-", "rap", "how", "lin", "ang", "par", "ant",
  "lle", "rit", "ate", "str", "cri", "tes", "000", "ID=", "per", "ide", "100",
  "olo", "ica", "sta", "/en", "on-", "ann", "ack", "ook", "ers", "ass", "und",
  "ill", "ian", "%20", "mar", "-de", "ble", "usi", "ain", "pri", "ame", "ode",
  "pic", "ed-", "one", "ite", "-re", "web", "ber", "/p/", "ult", "ens", "app",
  "min", "ess", "rea", "ext", "war", "ple", "us/", "you", "ram", "out", "ser",
  "eur", "duc", "ran", "ave", "ity", "off", "act", "use", "/10", "acc", "hl=",
  "ome", "s/1", "-wh", "ts-", "cha", "er-", "/re", "ell", "ari", "hin", "en-",
  "/de", "oli", "dis", "int", "end", "ard", "ry/", "ary", "st-", "est", "lea",
  "ace", "re-", "qui", "oni", "val", "ntr", "al_", "ani", "lan", "/ma", "ord",
  "tro", "ole", "ale", "tal", "tin", "sec", "cie", "s/c", "ics", "tri", "ela",
  "as-", "s/s", "mic", "500", "tha", "ath", "tle", "an-", "vel", "iss", "ini",
  "cia", "ull", "not", "-be", "/ca", "alt", "ies", "ele", "-fi"
]);
