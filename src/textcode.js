/**
 * The text-mode code: canonical Huffman lengths over body bytes plus the
 * three control symbols, and the substring token dictionary, both mined from
 * the corpus by tools/mine-text.mjs.
 *
 * Symbols 0..255 are bytes; 256 = TOKEN (an index follows), 257 = END,
 * 258 = ESC (a raw 8-bit byte follows). A length of 0 means the byte has no
 * code and is written via ESC. Codes are canonical: assigned by ascending
 * length, ties by ascending symbol, so the lengths array IS the whole code.
 *
 * Table format for wire v1. APPEND-ONLY in spirit: any change to either
 * table changes what existing payloads decode to, so a change here is a wire
 * version bump, never a patch.
 *
 * @module textcode
 */

/** Code length per symbol; index 256 TOKEN, 257 END, 258 ESC. */
export const CODE_LENGTHS = Object.freeze([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,12,0,12,15,6,7,15,9,9,15,10,10,5,6,5,6,6,5,6,7,7,7,7,6,7,9,14,0,7,0,8,13,7,8,7,8,9,8,9,10,9,11,11,9,9,9,9,9,12,9,8,9,11,10,10,12,11,12,0,0,0,0,4,0,5,6,6,6,4,7,6,6,5,9,7,5,6,5,5,6,10,5,5,5,5,7,7,8,7,9,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,4,5,15]);

export const SYM_TOKEN = 256, SYM_END = 257, SYM_ESC = 258;

/** Width of a token index after the TOKEN symbol. */
export const TOKEN_INDEX_BITS = 7;

/**
 * The substring dictionary, indexed as on the wire.
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  "articles/", "index.php", "/cgi-bin/", "anthropic", "/article", "index.ht",
  "content", "/2026/0", "/index.", "source", "search", "/blog/", "/news/",
  "/searc", "2026-0", "archiv", "detail", "-with-", "rchive", "claude", "image",
  ".php?", "story", "/post", "world", "roduc", "agent", "publi", "type=",
  "wiki", ".htm", ".jpg", "/wik", "html", "comm", "edia", "iki/", "/com",
  "info", "pedi", "tion", "medi", "ing-", "_con", "inal", "the-", ".asp",
  "ment", "ogra", ".pdf", "atch", "-the", "auto", "/201", "-to-", "comp",
  "page", "-of-", "view", "-ai-", "port", "play", "ture", "data", "book",
  "ject", "tech", "work", "-is-", "mon", "ons", "mpa", "org", "cam", "amp",
  "id=", "rig", "ign", "ori", "200", "and", "man", "que", "che", "000", "ile",
  "for", "_de", "pro", "str", "ist", "rap", "ter", "ver", "ID=", "par", "cri",
  "sta", "rit", "how", "scr", "ica", "100", "-co", "ang", "all", "-in", "nce",
  "%20", "al-", "ine", "act", "cha", "per", "ack", "lin", "ide", "tes", "es-",
  "ass", "olo", "mar", "pri", "ate", "lan", "res", "/ma", "on-"
]);
