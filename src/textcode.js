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

/** Code length per symbol (one hex digit each); index 256 TOKEN, 257 END, 258 ESC. */
export const CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000c0cf67f99faa56566567777679e0708d7878989a9bb99999c989baacbc0000405666476659756556a555577879000b00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000045f"].map((c) => parseInt(c, 16)));

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
