/**
 * The host field: a hostname in its own canonical Huffman code whose
 * terminal symbols are registrable suffixes (hostcode.js, mined by
 * tools/mine-host.mjs).
 *
 * This is the piece that keeps arbitrary domains cheap without a dictionary
 * entry per domain: "example.com" is seven name characters in a code tuned
 * to hostname letters, then one short symbol that both appends ".com" and
 * ends the field. A host whose ending is not in the suffix table simply
 * ends with the plain END symbol — every possible host encodes, today and
 * forever, with no table maintenance.
 *
 * @module host
 */

import { BitWriter, BitReader, ClentError } from "./bits.js";
import { buildCode, pushCode, readSymbol } from "./huffman.js";
import {
  HOST_CODE_LENGTHS, HOST_END, HOST_ESC, SUFFIX_BASE, SUFFIXES,
} from "./hostcode.js";

const HOST_CODE = buildCode(HOST_CODE_LENGTHS);
const HLEN = HOST_CODE.len;

/**
 * Longest host the decoder will reconstruct. DNS caps a name at 253
 * characters; the port adds a handful more.
 */
const MAX_HOST_CHARS = 260;

const HOST_ESC_COST = HLEN[HOST_ESC] + 8;

/** Bits to write one host byte: its own code, or ESC plus the raw byte. */
function hostLiteralCost(byte) {
  return HLEN[byte] || HOST_ESC_COST;
}

/**
 * The cheapest terminal for this host: a suffix symbol that absorbs its
 * ending, or the plain END symbol. Returns how many trailing characters the
 * terminal absorbs and which symbol to write.
 *
 * @param {string} host
 * @returns {{symbol: number, absorbed: number, bits: number}}
 */
function bestTerminal(host) {
  let symbol = HOST_END;
  let absorbed = 0;
  // margin = terminal bits minus the spelled bits it absorbs; lower is better
  let margin = HLEN[HOST_END];
  for (let i = 0; i < SUFFIXES.length; i++) {
    const suffix = SUFFIXES[i];
    const termLen = HLEN[SUFFIX_BASE + i];
    if (!termLen || host.length <= suffix.length || !host.endsWith(suffix)) continue;
    let spelled = 0;
    for (let k = 0; k < suffix.length; k++) spelled += hostLiteralCost(suffix.charCodeAt(k));
    if (termLen - spelled < margin) {
      symbol = SUFFIX_BASE + i;
      absorbed = suffix.length;
      margin = termLen - spelled;
    }
  }
  let bits = margin;
  for (let k = 0; k < host.length; k++) bits += hostLiteralCost(host.charCodeAt(k));
  return { symbol, absorbed, bits };
}

/**
 * The number of bits emitHost() would write for this host, without writing
 * them. Infinity for a host the decoder would refuse — the shape must never
 * enter the race, because winning it would produce a payload our own
 * decoder rejects.
 * @param {string} host
 * @returns {number}
 */
export function hostBits(host) {
  if (host.length > MAX_HOST_CHARS) return Infinity;
  return bestTerminal(host).bits;
}

/**
 * Write a host field: name characters, then a suffix terminal or END.
 * URL hosts are ASCII (IDNs arrive punycoded); anything else rides ESC.
 * @param {BitWriter} w
 * @param {string} host
 */
export function emitHost(w, host) {
  // Mirror of the decoder's cap: emitting past it would make a payload that
  // decodeHost refuses, which is strictly worse than failing here.
  if (host.length > MAX_HOST_CHARS)
    throw new ClentError("That host is too long to encode.");
  const { symbol, absorbed } = bestTerminal(host);
  const upto = host.length - absorbed;
  for (let k = 0; k < upto; k++) {
    const byte = host.charCodeAt(k);
    if (byte < 256 && HLEN[byte]) {
      pushCode(w, HOST_CODE, byte);
    } else if (byte < 256) {
      pushCode(w, HOST_CODE, HOST_ESC);
      w.push(byte, 8);
    } else {
      // Unreachable for URL-parsed hosts, which are ASCII; guard anyway.
      throw new ClentError("That host can't be encoded.");
    }
  }
  pushCode(w, HOST_CODE, symbol);
}

/**
 * Read a host field back. Every malformed sequence is a ClentError, never a
 * silently substituted character.
 * @param {BitReader} reader
 * @returns {string}
 */
export function decodeHost(reader) {
  let host = "";
  for (;;) {
    const symbol = readSymbol(reader, HOST_CODE);
    if (symbol === HOST_END) break;
    if (symbol >= SUFFIX_BASE) {
      const suffix = SUFFIXES[symbol - SUFFIX_BASE];
      if (suffix === undefined)
        throw new ClentError("This link uses an unknown host suffix.");
      host += suffix;
      break;
    }
    host += String.fromCharCode(symbol === HOST_ESC ? reader.read(8) : symbol);
    if (host.length > MAX_HOST_CHARS)
      throw new ClentError("This link is damaged — the host is far too long.");
  }
  return host;
}
