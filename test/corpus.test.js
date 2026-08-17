/**
 * Validation against real URLs.
 *
 * The frozen corpus in corpus/urls.txt.gz is real traffic: external links
 * cited on Wikipedia, links submitted to Hacker News, and the Majestic Million
 * domain ranking. It contains things no author would think to write a test
 * for — doubled slashes, unencoded spaces, mojibake, 3 KB query strings,
 * session tokens, punycode, and every flavour of trailing punctuation.
 *
 * CI runs a bounded slice to stay fast. `npm run validate` runs the lot.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { readCorpus, hasCorpus, emptyStats, check, percentile } from "../tools/corpus.js";

const LIMIT = Number(process.env.CLENT_CORPUS_LIMIT) || 25000;

test("real URLs round-trip exactly", { skip: hasCorpus() ? false : "no corpus (npm run corpus:fetch)" },
  async (t) => {
    const stats = emptyStats();
    for await (const url of readCorpus(LIMIT)) {
      await check(url, stats, { maxFailures: 20 });
    }

    if (stats.failures.length) {
      for (const failure of stats.failures) {
        t.diagnostic(`${failure.reason}: ${failure.url}`);
        if (failure.detail) t.diagnostic(`  -> ${failure.detail}`);
      }
    }

    assert.equal(stats.failures.length, 0,
      `${stats.failures.length} of ${stats.checked + stats.failures.length} real URLs failed`);
    assert.ok(stats.checked > 1000, `expected a usable corpus, checked ${stats.checked}`);

    const ratio = stats.payloadBytes / stats.inputBytes;
    t.diagnostic(`checked ${stats.checked.toLocaleString()} URLs, ` +
      `${stats.skipped} unparseable`);
    t.diagnostic(`payload is ${(100 * ratio).toFixed(1)}% of input overall, ` +
      `median ${(100 * percentile(stats.ratios, 0.5)).toFixed(1)}%`);
    t.diagnostic(`shorter than input: ${(100 * stats.shorter / stats.checked).toFixed(1)}%`);
    t.diagnostic(`modes: ${JSON.stringify(stats.modes)}`);

    // A regression that made every payload longer than its input would still
    // round-trip, and would still be useless. Guard the actual product claim.
    assert.ok(ratio < 1,
      `payloads should average smaller than their inputs, got ${ratio.toFixed(3)}`);
  });

test("the corpus is real and varied", { skip: hasCorpus() ? false : "no corpus" }, async () => {
  const hosts = new Set();
  const tlds = new Set();
  let withQuery = 0, withFragment = 0, nonAscii = 0, n = 0;

  for await (const url of readCorpus(20000)) {
    n++;
    try {
      const parsed = new URL(url);
      hosts.add(parsed.hostname);
      tlds.add(parsed.hostname.split(".").pop());
      if (parsed.search) withQuery++;
      if (parsed.hash) withFragment++;
    } catch { /* counted by the round-trip test */ }
    if (/[^\x20-\x7e]/.test(url)) nonAscii++;
  }

  // If any of these collapse, the corpus has silently become uniform and the
  // round-trip test above stops proving very much.
  assert.ok(hosts.size > n / 20, `expected many distinct hosts, got ${hosts.size} in ${n}`);
  assert.ok(tlds.size > 50, `expected a long TLD tail, got ${tlds.size}`);
  assert.ok(withQuery > n / 50, `expected query strings, got ${withQuery}`);
  assert.ok(nonAscii > 0, "expected at least some non-ASCII URLs");
});
