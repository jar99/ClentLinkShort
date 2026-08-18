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
export const CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000c0bf79d99eab57566667777669f0709a7778888999a988989888989999f0f05056665776587566569555677868000c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005fbddabcdd7f00000abbbccccda9affbbdaa9baabbaeaaebbbbbbbccccbcbcccdcdcecdcd98b8acae8abd9a9aaaaaababdcacbcabaaaaabaebaaaaaabbaaababbbabaaaabbbbdabaabaabbbbbbcbbbbbcbbbbbbbbbbbbbcbbbbccbbbbbbcbbbabcbdcbbbaccbbcbbbbbbccbbcccccccbabcbcccccccdcbbbbccccccbbbbcaccccc"].map((c) => parseInt(c, 16)));

export const SYM_END = 256, SYM_ESC = 257, TOKEN_BASE = 258;

/**
 * The substring dictionary, indexed as on the wire (symbol TOKEN_BASE + k).
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  "?utm_source=", "technology", "articles/", "/article", "content", "release",
  "ecurity", "medium=", "/wiki/", "roject", "wiki/A", "wiki/B", "wiki/F",
  "wiki/C", "wiki/D", "/news/", "search", "/tags/", "/11711", "/index", "-with-",
  "archiv", "google", "system", "&utm_", ".html", "/blog", "etail", "blog/",
  ".php?", "/post", "build", "/pro", ".jpg", "tion", "comm", "_of_", "edia",
  "info", "camp", "-of-", "inal", "ment", "-to-", "deta", "atch", "11/0",
  "ight", "ogra", "port", "ture", "book", "scri", "-new", "ener", ".pdf",
  "-pro", "data", "view", "from", ".asp", "-you", "ient", "-is-", "poli",
  "hat-", "loud", "why-", "face", "-ai-", "euro", "age", "ing", "ack", "/20",
  "/10", "pac", "202", "ge/", "the", "/pa", "201", "ng-", "and", "ons", "ter",
  "ign", "gin", "man", "-in", "for", "ver", "ers", "nce", "er-", "nd-", "mpa",
  "ine", "000", "100", "07/", "org", "6/0", "ile", "-co", "tor", "ori", "es-",
  "de_", "on-", "007", "que", "all", "est", "sta", "ate", "res", "-re", "'s_",
  "on_", "id=", "wor", "ica", "ant", "ard", "app", "gen", "ang", "ive", "one",
  "ed-", "how", "al-", "ame", "act", "en_", "-de", "ils", "ls/", "ill", "cha",
  "rea", "per", "25/", "ist", "ide", "und", "ell", "par", "aut", "ven", "int",
  "ark", "ble", "an-", "che", "out", "er_", "_Co", "str", "der", "The", "in_",
  "ber", "en-", "ode", "ian", "le-", "mar", "et_", "ock", "/p/", "ext", "pho",
  "200", "pla", "21/", "24/", "ann", "ice", "rth", "to_", "ess", "ran", "es_",
  "lit", "ass", "-a-", "re-", "/co", "are", "ans", "ave", "hot", "duc", "in/",
  "tra", "us/", "mon", "pub", "ick", "ser", "in-", "ics", "ast", "Cha", "/en",
  "dis", "16/", "ite", "ens", "mic", "nt-", "ome", "st-", "unt", "web", "ake",
  "urn", "ch-", "-cl", "-ma", "lin", "tle", "ous", "ust", "le_", "04/", "06/",
  "08/", "09/", "05/", "dow", "own", "ish", "end", "cie", "pri", "ts-", "ash",
  "New", "off", "ary", "17/", "vel", "ari", "ali", "ts/", "-ca", "oci", "/de",
  "not", "ita", "-ex", "ris", "-fi"
]);
