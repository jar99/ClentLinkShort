/**
 * Shared corpus loading and validation, used by both the CI test and the
 * standalone report runner so they can never disagree about what "passing"
 * means.
 */

import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyze, expand, parse, MODE_NAMES } from "../src/clent.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CORPUS_FILE = path.join(ROOT, "corpus", "urls.txt.gz");

export const hasCorpus = () => existsSync(CORPUS_FILE);

/**
 * Stream URLs out of the frozen corpus.
 * @param {number} [limit] stop after this many
 * @returns {AsyncGenerator<string>}
 */
export async function* readCorpus(limit = Infinity) {
  const lines = createInterface({
    input: createReadStream(CORPUS_FILE).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of lines) {
    const url = line.trim();
    if (!url) continue;
    yield url;
    if (++n >= limit) break;
  }
  lines.close();
}

/**
 * @typedef {object} CorpusStats
 * @property {number} checked URLs that parsed and were encoded
 * @property {number} skipped URLs the URL parser itself rejected
 * @property {Array<{url: string, reason: string, detail?: string}>} failures
 * @property {Record<string, number>} modes winning body mode counts
 * @property {number} shorter payloads shorter than the input URL
 * @property {number} inputBytes total input length
 * @property {number} payloadBytes total payload length
 * @property {number[]} ratios payload/input per URL
 * @property {number} dictHits URLs whose host hit the dictionary
 * @property {number} trackingStripped URLs that had tracking parameters
 */

/** @returns {CorpusStats} */
export function emptyStats() {
  return {
    checked: 0, skipped: 0, failures: [],
    modes: Object.fromEntries(MODE_NAMES.map((m) => [m, 0])),
    shorter: 0, inputBytes: 0, payloadBytes: 0, ratios: [],
    dictHits: 0, trackingStripped: 0,
  };
}

/**
 * Encode a URL, decode it back, and confirm the destination is byte-identical.
 *
 * This is the whole contract: a link that decodes to anything other than what
 * was encoded is a silent redirect to the wrong place, which is far worse than
 * a link that fails loudly.
 *
 * @param {string} raw
 * @param {CorpusStats} stats
 * @param {{maxFailures?: number}} [options]
 */
export async function check(raw, stats, { maxFailures = 50 } = {}) {
  let expected;
  try {
    expected = parse(raw).href;
  } catch {
    stats.skipped++;
    return true;
  }

  const record = (reason, detail) => {
    if (stats.failures.length < maxFailures) stats.failures.push({ url: raw, reason, detail });
    return false;
  };

  let result;
  try {
    // Tracking stripping is off: it deliberately changes the destination, so
    // leaving it on would make an exact round-trip meaningless.
    result = await analyze(raw, { stripTracking: false });
  } catch (error) {
    return record("encode threw", error.message);
  }

  if (!/^[A-Za-z0-9_-]+$/.test(result.payload)) {
    return record("payload is not URL-safe", result.payload.slice(0, 60));
  }

  let actual;
  try {
    actual = (await expand(result.payload)).href;
  } catch (error) {
    return record("decode threw", error.message);
  }
  if (actual !== expected) return record("round-trip mismatch", actual);

  stats.checked++;
  stats.modes[result.modeName]++;
  stats.inputBytes += raw.length;
  stats.payloadBytes += result.payload.length;
  stats.ratios.push(result.payload.length / raw.length);
  if (result.payload.length < raw.length) stats.shorter++;
  if (result.hostByte !== null) stats.dictHits++;

  // Measured separately so the tracking-strip win can be reported honestly.
  try {
    if ((await analyze(raw, { stripTracking: true })).removed.length) stats.trackingStripped++;
  } catch { /* already counted above */ }

  return true;
}

/** @param {number[]} values @param {number} p 0..1 */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
