/**
 * DEFLATE, via the browser-native CompressionStream/DecompressionStream.
 *
 * Decompression is bounded. A fragment is attacker-controlled, and DEFLATE
 * amplifies: before the bound existed, a 27,000-character payload inflated to
 * a 20 MB string on the main thread before any validation saw it. A decoded
 * body must become a URL the codec is willing to return, so anything past
 * MAX_INFLATED is cut off and rejected while it is still small.
 *
 * @module deflate
 */

import { ClentError } from "./bits.js";

/** Whether this runtime can compress. Without it links are simply longer. */
export const canCompress = typeof CompressionStream !== "undefined";

/** Upper bound on decompressed size; see the module note. */
export const MAX_INFLATED = 16384;

/**
 * @param {typeof CompressionStream | typeof DecompressionStream} Ctor
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {number} limit abort once the output passes this many bytes
 * @returns {Promise<Uint8Array>}
 */
async function runStream(Ctor, bytes, limit) {
  const stream = new Ctor("deflate-raw");
  const writer = stream.writable.getWriter();
  // Corrupt input rejects on the writable side as well as the readable one.
  // Keep a handle on it so it surfaces here instead of as an unhandled
  // rejection, but don't let it reject before the read below observes it.
  const pump = writer.write(bytes).then(() => writer.close());
  pump.catch(() => {});

  // Chunked read rather than Response(...).arrayBuffer(): the whole point of
  // the limit is to stop *before* a hostile stream has been materialised.
  const reader = stream.readable.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new ClentError("This link decompresses to something far too large.");
    }
  }
  await pump;

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<Uint8Array|null>} null where the runtime can't compress
 */
export async function deflate(bytes) {
  if (!canCompress) return null;
  try {
    return await runStream(CompressionStream, bytes, Infinity);
  } catch {
    return null; // engines that have CompressionStream but not "deflate-raw"
  }
}

/**
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<Uint8Array>}
 * @throws {ClentError} on corrupt input or output past MAX_INFLATED
 */
export async function inflate(bytes) {
  if (typeof DecompressionStream === "undefined")
    throw new ClentError("This browser can't decompress the link (needs DecompressionStream).");
  try {
    return await runStream(DecompressionStream, bytes, MAX_INFLATED);
  } catch (error) {
    // The size-limit ClentError carries the accurate message; only foreign
    // errors (zlib corruption) get wrapped.
    if (error instanceof ClentError) throw error;
    throw new ClentError("This link is damaged — decompression failed.");
  }
}
