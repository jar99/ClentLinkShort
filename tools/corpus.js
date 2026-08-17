/**
 * Corpus loading and validation, shared by the CI test and the report runner
 * so they cannot disagree about what passing means.
 */

import { createReadStream, existsSync } from "node:fs";
import { createBrotliDecompress } from "node:zlib";
import { createInterface } from "node:readline";
import path from "node:path";

import { analyze, expand, parse, stripTracking } from "../src/clent.js";
import { ROOT } from "./bundle.js";

export const CORPUS_FILE = path.join(ROOT, "corpus", "urls.txt.br");
export const RANKS_FILE = path.join(ROOT, "corpus", "ranks.txt.br");

export const hasCorpus = () => existsSync(CORPUS_FILE);
export const hasRanks = () => existsSync(RANKS_FILE);

/**
 * The link prefix savings are measured against. Real savings depend on the
 * domain the site is served from, so it is stated rather than assumed away.
 */
export const DEFAULT_ORIGIN = "https://jar99.github.io/ClentLinkShort/#";

/** Stream lines out of a brotli-compressed text file. */
export async function* readLines(file, limit = Infinity) {
  const lines = createInterface({
    input: createReadStream(file).pipe(createBrotliDecompress()),
    crlfDelay: Infinity,
  });
  let n = 0;
  for await (const line of lines) {
    const value = line.trim();
    if (!value) continue;
    yield value;
    if (++n >= limit) break;
  }
  lines.close();
}

export const readCorpus = (limit) => readLines(CORPUS_FILE, limit);
export const readRanks = (limit) => readLines(RANKS_FILE, limit);

/** @returns {ReturnType<typeof emptyStats>} */
export function emptyStats() {
  return {
    checked: 0,
    skipped: 0,
    /** @type {Array<{url: string, reason: string, detail?: string}>} */
    failures: [],
    /** @type {Array<{url: string, wasted: number}>} */
    suboptimal: [],
    modes: { text6: 0, raw: 0, deflate: 0, template: 0 },
    inputBytes: 0,
    payloadBytes: 0,
    /** payload length / input length, per URL */
    ratios: [],
    /** 1 - (full link length / input length), per URL; negative means longer */
    linkSavings: [],
    payloadShorter: 0,
    linkShorter: 0,
    dictHits: 0,
    withTracking: 0,
    trackingSavedBytes: 0,
    trackingBaseBytes: 0,
    /**
     * Bare `https://host/` URLs are the worst case for any shortener and
     * behave nothing like the links people actually shorten, so they are
     * counted apart instead of being averaged into one misleading number.
     */
    bare: { count: 0, linkShorter: 0, savings: [] },
    deep: { count: 0, linkShorter: 0, savings: [] },
    /** Input length paired with payload length, for break-even analysis. */
    pairs: [],
  };
}

/**
 * Encode a URL, decode it, and confirm the destination survives byte for byte.
 *
 * That is the whole contract. A link that decodes to anything other than what
 * went in is a silent redirect to the wrong place, which is worse than a link
 * that fails loudly.
 *
 * @param {string} raw
 * @param {ReturnType<typeof emptyStats>} stats
 * @param {{maxFailures?: number, origin?: string}} [options]
 */
export async function check(raw, stats, { maxFailures = 50, origin = DEFAULT_ORIGIN } = {}) {
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
    // Tracking stripping is off here: it deliberately changes the destination,
    // so leaving it on would make an exact round-trip meaningless.
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

  // The encoder builds every body mode and is supposed to keep the shortest.
  // Cheap to verify on every single URL, so it is.
  const offered = Object.values(result.candidates).filter((n) => n !== null);
  if (result.payload.length !== Math.min(...offered)) {
    stats.suboptimal.push({
      url: raw,
      wasted: result.payload.length - Math.min(...offered),
    });
  }

  const linkLength = origin.length + result.payload.length;
  stats.checked++;
  // A mode name emptyStats does not declare means analyze() grew a mode this
  // harness has never heard of — that must fail the run, not vanish from it.
  if (!(result.modeName in stats.modes)) {
    throw new Error(`analyze() returned unknown mode "${result.modeName}"`);
  }
  stats.modes[result.modeName]++;
  stats.inputBytes += raw.length;
  stats.payloadBytes += result.payload.length;
  stats.ratios.push(result.payload.length / raw.length);
  stats.linkSavings.push(1 - linkLength / raw.length);
  if (result.payload.length < raw.length) stats.payloadShorter++;
  if (linkLength < raw.length) stats.linkShorter++;
  if (result.hostByte !== null) stats.dictHits++;

  stats.pairs.push([raw.length, result.payload.length]);

  const bucket = /^https?:\/\/[^/]+\/?$/.test(raw) ? stats.bare : stats.deep;
  bucket.count++;
  bucket.savings.push(1 - linkLength / raw.length);
  if (linkLength < raw.length) bucket.linkShorter++;

  // What tracking-parameter stripping is actually worth, measured only on the
  // URLs that carry any. Probing with stripTracking on a clone first keeps
  // the expensive second analyze() off the ~96% of URLs with nothing to
  // strip — it used to run on every one, doubling the whole scan.
  try {
    if (stripTracking(new URL(expected)).length) {
      const cleaned = await analyze(raw, { stripTracking: true });
      stats.withTracking++;
      stats.trackingBaseBytes += result.payload.length;
      stats.trackingSavedBytes += result.payload.length - cleaned.payload.length;
    }
  } catch { /* already counted above */ }

  return true;
}

/** @param {number[]} values @param {number} p 0..1 */
export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

export const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

/**
 * How long does a URL have to be before the whole link comes out shorter?
 *
 * The codec shrinks the destination, but the finished link also carries the
 * site's own address. On a long domain that fixed cost can swallow the entire
 * saving, so the useful question is not "does this compress" but "from what
 * length does compressing it actually pay".
 *
 * @param {Array<[number, number]>} pairs [inputLength, payloadLength]
 * @param {number} originLength characters before the payload
 * @returns {{breakEven: number|null, shorterPct: number, medianSaving: number}}
 */
export function breakEven(pairs, originLength) {
  if (!pairs.length) return { breakEven: null, shorterPct: 0, medianSaving: 0 };

  let shorter = 0;
  const savings = [];
  for (const [input, payload] of pairs) {
    const link = originLength + payload;
    if (link < input) shorter++;
    savings.push(1 - link / input);
  }

  // Smallest input length at which at least half of URLs that long come out
  // shorter. Measured rather than derived, because payload length is not a
  // fixed multiple of input length.
  let point = null;
  for (let length = 10; length <= 400; length += 5) {
    const band = pairs.filter(([input]) => input >= length && input < length + 40);
    if (band.length < 30) continue;
    const win = band.filter(([input, payload]) => originLength + payload < input).length;
    if (win / band.length >= 0.5) {
      point = length;
      break;
    }
  }

  return {
    breakEven: point,
    shorterPct: (100 * shorter) / pairs.length,
    medianSaving: percentile(savings, 0.5),
  };
}
