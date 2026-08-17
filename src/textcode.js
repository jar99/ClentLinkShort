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
 * Table format for wire v7. APPEND-ONLY in spirit: any change to either
 * table changes what existing payloads decode to, so a change here is a wire
 * version bump, never a patch.
 *
 * @module textcode
 */

/** Code length per symbol; index 256 TOKEN, 257 END, 258 ESC. */
export const CODE_LENGTHS = Object.freeze([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,14,0,12,15,7,8,15,10,11,15,10,10,5,5,5,6,6,6,7,7,7,7,7,7,7,11,15,0,8,0,9,13,8,9,9,9,9,9,9,10,9,11,11,9,9,10,10,9,12,10,9,10,11,10,11,12,12,12,0,0,0,0,5,0,4,6,5,6,4,6,6,6,4,8,7,5,6,5,4,6,9,5,5,5,5,7,7,8,7,8,0,0,0,11,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,5,5,15]);

export const SYM_TOKEN = 256, SYM_END = 257, SYM_ESC = 258;

/** Width of a token index after the TOKEN symbol. */
export const TOKEN_INDEX_BITS = 7;

/**
 * The substring dictionary, indexed as on the wire.
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  "?utm_source=", ".jpg?utm_sou", "jpg?utm_sour", "wiki/File:%2", "s.wikimedia.",
  "=commons.wik", "org&utm_camp", "rg&utm_campa", "=imageinfo&u", "/wiki/File:%",
  "iki/File:%22", "&utm_campaig", "utm_source=c", "dia.org&utm_", ".org&utm_cam",
  "g&utm_campai", "n=imageinfo&", "geinfo&utm_c", "nfo&utm_cont", "&utm_content",
  "utm_content=", "tm_campaign=", "ce=commons.w", "kimedia.org&", "media.org&ut",
  "edia.org&utm", "ia.org&utm_c", "a.org&utm_ca", "mageinfo&utm", "ageinfo&utm_",
  "info&utm_con", "/wikipedia/c", "wikipedia/co", "kipedia/comm", "ikipedia/com",
  "pedia/common", "dia/commons/", "ipedia/commo", "edia/commons", "content=orig",
  "ntent=origin", "_content=ori", "ontent=origi", "tent=origina", "ent=original",
  "uscrit_autog", "it_autograph", "t_autographe", "manuscrit_au", "anuscrit_aut",
  "nuscrit_auto", "scrit_autogr", "rit_autograp", "crit_autogra", "cklist/2011/",
  "klist/2011/s", "hecklist/201", "ecklist/2011", "checklist/20", "rch/all/key/",
  "nnual-checkl", "-checklist/2", "list/2011/se", "st/2011/sear", "t/2011/searc",
  "arch/all/key", "annual-check", "nual-checkli", "ual-checklis", "talogueoflif",
  "catalogueofl", "alogueoflife", "atalogueofli", "ccompagnemen", "d%27orchestr",
  "/wiki/File:!", "vec_accompag", "ec_accompagn", "c_accompagne", "tographe%29",
  "_-_btv1b10", "-_btv1b108", "-_btv1b100", "-_btv1b525", "_btv1b1007", ".wikipedia",
  "/watch?v=", "tographe)", "orchestre", ".substack", "_-_btv1b5", "_orchestr",
  "/2026/0", "article", "/articl", "search", "/index", "/blog/", ".co.uk",
  "google", "_pour_", "2026-0", "%C3%A", ".html", "C3%A9", "%D0%B", ".org/",
  ").jpg", ".php?", "%D1%8", "-the-", "world", "%C3%B", ".com", "_%28", "%22_",
  "_of_", "%2C_", "news", "/%22", "tion", "ing-", ".net", ".gov", "_de_",
  "ment", "id=", "200"
]);
