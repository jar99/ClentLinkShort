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
export const CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000c0bf79d99fbb5756666777776af080987888889999a98999a888989aa9f0f050565657665776665695556778780f0c0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004fbddace7f0f00bfafbccd9bacccccdd9aaaabbabcbbbbbfbbcccbcccbccbccccedddd8b88e9ac99edb9aaaabbabaabaaababaaababbabaaaababbabbbbbbcbbbabbbabcbbbbbbbbbbabbbbbbbbbbbbbcbcbbbbcbbbbcbcbbcbbbbccbbbcccbbbccccbbbcbbbdcbcccbcbcbcbcbccbcbcbabcbccbccbbbbccccbcccccbdbccccbb"].map((c) => parseInt(c, 16)));

export const SYM_END = 256, SYM_ESC = 257, TOKEN_BASE = 258;

/**
 * The substring dictionary, indexed as on the wire (symbol TOKEN_BASE + k).
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  "?utm_source=", "/index.php", "articles/", "/article", "/117112", "release",
  "/wiki/", "roject", "wiki/A", "wiki/B", "wiki/C", "wiki/D", "/blog/", "wiki/F",
  "/news/", "detail", "search", "/tags/", "-with-", "public", ".html", "-the-",
  "&utm_", ".php?", "/the-", "/post", "graph", "ology", "from-", "secur",
  "/pro", "tion", "atio", "comm", "_of_", "-of-", "edia", "-to-", "atch",
  "medi", "11/0", "ight", "book", "tech", "camp", "mpai", "view", "the_",
  "25/0", "data", ".pdf", "ture", "comp", "-new", ".asp", "port", "The_",
  "-you", "-pro", "-is-", "poli", "goog", "scri", "ffic", "why-", "tics",
  "gram", "our-", "ing", "ack", "age", "/20", "10.", "/10", "202", "pac",
  "ent", "/pa", "ge/", "ng-", "201", "and", "ter", "all", "for", "ver", "000",
  "ers", "-in", "mon", "-co", "con", "er-", "ine", "ive", "es-", "6/0", "wor",
  "id=", "nal", "tor", "man", "al-", "sta", "nce", "'s_", "ill", "le-", "ons",
  "on-", "est", "ist", "how", "-re", "ang", "ity", "rea", "ed-", "app", "pla",
  "enc", "ign", "100", "07/", "end", "ard", "und", "ode", "ell", "ant", "-de",
  "ide", "per", "ark", "ess", "ame", "an-", "one", "ile", "org", "que", "ite",
  "che", "lin", "ate", "fil", "int", "out", "tra", "ock", "on_", "rth", "are",
  "ain", "hat", "us/", "200", "ome", "web", "en-", "ext", "cha", "-ma", "/p/",
  "re-", "ult", "ble", "her", "ts-", "21/", "off", "ser", "oll", "ass", "ene",
  "eng", "16/", "ens", "ori", "aut", "24/", "own", "chi", "ast", "dis", "111",
  "ner", "ann", "/ma", "ali", "ime", "en_", "ld-", "_Co", "ary", "ber", "par",
  "in-", "08/", "ai-", "min", "in/", "ick", "unt", "ric", "not", "vel", "Cha",
  "net", "-su", "ust", "ood", "ts/", "bus", "act", "ani", "se-", "duc", "cli",
  "tle", "-cl", "s-a", "-ex", "der", "/de", "ari", "er_", "ls/", "ory", "ake",
  "an_", "05/", "06/", "/re", "hot", "ial", "ree", "es_", "ave", "hou", "cor",
  "res", "mic", "-lo", "-be", "on/", "eed", "-st", "way", "son", "ly-", "nt-",
  "ype", "s-s", "ope", "ies"
]);
