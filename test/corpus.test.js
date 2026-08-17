/**
 * Validation against real URLs.
 *
 * The corpus in corpus/urls.txt.br is real traffic: Wikipedia citations from
 * 30 language editions, Hacker News submissions, Lemmy posts, RSS feeds,
 * Wikimedia Commons images and Tranco-ranked domains. It contains things
 * nobody would think to write a test for.
 *
 * One scan feeds every assertion — this suite used to run three identical
 * scans and pay for ~240,000 analyze() calls where ~80,000 suffice. CI runs a
 * bounded slice; `npm run validate` runs the lot.
 */
import test, { before } from "node:test";
import assert from "node:assert/strict";

import {
  readCorpus, hasCorpus, emptyStats, check, percentile, breakEven, DEFAULT_ORIGIN,
} from "../tools/corpus.js";
import { shorten } from "../src/clent.js";

const LIMIT = Number(process.env.CLENT_CORPUS_LIMIT) || 40000;
const skip = hasCorpus() ? false : "no corpus (npm run corpus:fetch)";

const stats = emptyStats();
const variety = { hosts: new Set(), tlds: new Set(), withQuery: 0, nonAscii: 0, deep: 0, n: 0 };

before(async () => {
  if (skip) return;
  for await (const url of readCorpus(LIMIT)) {
    await check(url, stats, { maxFailures: 20 });

    variety.n++;
    try {
      const parsed = new URL(url);
      variety.hosts.add(parsed.hostname);
      variety.tlds.add(parsed.hostname.split(".").pop());
      if (parsed.search) variety.withQuery++;
      if (parsed.pathname.length > 1) variety.deep++;
    } catch { /* counted as a failure by check() if the codec also rejects it */ }
    if (/[^\x20-\x7e]/.test(url)) variety.nonAscii++;
  }
});

test("real URLs round-trip exactly", { skip }, (t) => {
  for (const failure of stats.failures) {
    t.diagnostic(`${failure.reason}: ${failure.url}`);
    if (failure.detail) t.diagnostic(`  -> ${failure.detail}`);
  }

  assert.equal(stats.failures.length, 0,
    `${stats.failures.length} of ${stats.checked + stats.failures.length} real URLs failed`);
  assert.ok(stats.checked > 1000, `expected a usable corpus, checked ${stats.checked}`);

  t.diagnostic(`checked ${stats.checked.toLocaleString()}, ${stats.skipped} unparseable`);
  t.diagnostic(`payload ${(100 * stats.payloadBytes / stats.inputBytes).toFixed(1)}% of input, ` +
    `median ${(100 * percentile(stats.ratios, 0.5)).toFixed(1)}%`);
  t.diagnostic(`modes: ${JSON.stringify(stats.modes)}`);
});

test("the shortest body mode is always the one used", { skip }, (t) => {
  // The encoder builds every candidate. Keeping anything other than the
  // smallest would be a silent regression: links would still work, just be
  // needlessly long, and no round-trip test would notice.
  for (const miss of stats.suboptimal.slice(0, 10)) {
    t.diagnostic(`${miss.wasted} chars wasted: ${miss.url}`);
  }
  assert.equal(stats.suboptimal.length, 0,
    `${stats.suboptimal.length} URLs were not encoded with the shortest available mode`);
});

test("savings hold up on real links", { skip }, async (t) => {
  const payloadShorter = 100 * stats.payloadShorter / stats.checked;
  const deepShorter = 100 * stats.deep.linkShorter / stats.deep.count;
  const point = breakEven(stats.pairs, DEFAULT_ORIGIN.length - 1);

  t.diagnostic(`payload beats the input URL for ${payloadShorter.toFixed(1)}% of URLs`);
  t.diagnostic(`whole link beats it for ${deepShorter.toFixed(1)}% of deep links, ` +
    `with a ${DEFAULT_ORIGIN.length}-character prefix`);
  t.diagnostic(`break-even input length: ${point.breakEven ?? "never"} characters`);

  // What the codec is responsible for: the payload must be smaller than the
  // URL it encodes.
  assert.ok(stats.payloadBytes < stats.inputBytes,
    "payloads should be smaller than their inputs on average");
  assert.ok(payloadShorter > 90,
    `payload should beat the input for most URLs, got ${payloadShorter.toFixed(1)}%`);

  // What the codec is not responsible for: the site's own address is fixed
  // overhead on every link, and on a long one it swallows the whole saving.
  // The break-even point needs long URLs to measure and the CI slice may not
  // contain enough of them, so the claim is checked directly instead.
  const long = "https://example.com/" +
    "some-fairly-typical-article-slug-that-goes-on/".repeat(8);
  const payload = await shorten(long, { stripTracking: false });
  assert.ok(DEFAULT_ORIGIN.length + payload.length < long.length,
    `a ${long.length}-character URL should still come out shorter, ` +
    `got ${DEFAULT_ORIGIN.length + payload.length}`);
});

test("the corpus is varied enough to prove anything", { skip }, () => {
  // If these collapse the corpus has gone uniform, and the tests above stop
  // proving much.
  const { hosts, tlds, withQuery, nonAscii, deep, n } = variety;
  assert.ok(hosts.size > n / 20, `expected many distinct hosts, got ${hosts.size} in ${n}`);
  assert.ok(tlds.size > 50, `expected a long TLD tail, got ${tlds.size}`);
  assert.ok(withQuery > n / 50, `expected query strings, got ${withQuery}`);
  assert.ok(deep > n / 2, `expected mostly deep links, got ${deep}`);
  assert.ok(nonAscii > 0, "expected some non-ASCII URLs");
});
