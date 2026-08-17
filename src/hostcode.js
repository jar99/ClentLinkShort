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
 * Symbols 0..255 are bytes; 256 = END, 257 = ESC (a raw 8-bit byte follows),
 * 258+k = "append SUFFIXES[k], then end". Codes are canonical: assigned by
 * ascending length, ties by ascending symbol, so the lengths array IS the
 * whole code.
 *
 * Table format for wire v1. Any change to either table changes what existing
 * payloads decode to, so a change here is a wire version bump, never a patch.
 *
 * @module hostcode
 */

/** Code length per symbol (one hex digit each); 256 END, 257 ESC, 258+k terminals. */
export const HOST_CODE_LENGTHS = Object.freeze([..."000000000000000000000000000000000000000f0000f750999aaaaaaaf000000000000000000000000000000000000f04655465548655445954456686800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000007fecefdfeaedfdbdecdeedcbcedddeededddeeeededdcddddcdecbcdd9deeddedbdddbd5aaac87ddcaececdbccdbbc8bbbbabaddbacaaccdaaeadd9bdedcecdcdf"].map((c) => parseInt(c, 16)));

export const HOST_END = 256, HOST_ESC = 257, SUFFIX_BASE = 258;

/**
 * Suffix per terminal symbol, longest first so greedy matching is safe.
 * @type {readonly string[]}
 */
export const SUFFIXES = Object.freeze([
  ".sourceforge.net", ".wikipedia.org", ".wordpress.com", ".bearblog.dev",
  ".blogspot.com", ".in-addr.arpa", ".stanford.edu", ".substack.com", ".harvard.edu",
  ".google.com", ".medium.com", ".vercel.app", ".github.io", ".yahoo.com",
  ".narod.ru", ".nasa.gov", ".free.fr", ".gouv.fr", ".mit.edu", ".com.ar",
  ".com.au", ".com.br", ".com.cn", ".com.mx", ".com.tr", ".com.tw", ".com.ua",
  ".com.vn", ".edu.au", ".edu.cn", ".edu.tw", ".gov.au", ".gov.br", ".gov.cn",
  ".gov.in", ".gov.tr", ".gov.tw", ".gov.ua", ".gov.uk", ".gov.vn", ".online",
  ".org.il", ".org.uk", ".social", ".ac.il", ".ac.jp", ".ac.th", ".ac.uk",
  ".cloud", ".co.id", ".co.il", ".co.jp", ".co.kr", ".co.nz", ".co.th", ".co.uk",
  ".co.za", ".go.jp", ".go.th", ".ne.jp", ".or.jp", ".space", ".blog", ".info",
  ".live", ".site", ".tech", ".app", ".biz", ".com", ".dev", ".edu", ".gov",
  ".int", ".net", ".org", ".pro", ".top", ".xyz", ".ai", ".ar", ".at", ".au",
  ".be", ".br", ".ca", ".cc", ".ch", ".cl", ".cn", ".co", ".cz", ".de", ".dk",
  ".es", ".eu", ".fi", ".fr", ".gr", ".hu", ".id", ".il", ".in", ".io", ".ir",
  ".it", ".jp", ".kr", ".me", ".mx", ".nl", ".no", ".nz", ".pl", ".pt", ".ro",
  ".ru", ".se", ".sk", ".th", ".tr", ".tv", ".tw", ".ua", ".uk", ".us", ".vn",
  ".za"
]);
