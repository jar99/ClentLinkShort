/**
 * Does the encoder actually produce the smallest link it could?
 *
 * `shorten()` measures the three body encodings, but it decides the rest by
 * rule: use the dictionary when the host is in it, strip `www.` when present,
 * fall back to verbatim only when it has to. Those rules are reasonable, and
 * reasonable is not the same as correct.
 *
 * So the check here does not trust the rules. It builds a payload for every
 * combination of every choice, confirms each one decodes back to the same URL,
 * and asserts the encoder's answer is no longer than the best of them.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { allCandidates, checkOptimal } from "../tools/optimality.js";
import { shorten, expand, parse, HOSTS } from "../src/clent.js";
import { readCorpus, hasCorpus } from "../tools/corpus.js";

const CASES = [
  "https://example.com",
  "https://example.com/",
  "https://www.example.com/path/to/page",
  "https://www.github.com/anthropics/claude-code",
  "https://github.com/anthropics/claude-code",
  "https://www.google.com/search?q=hello+world",
  "http://example.com:8080/x?y=1#z",
  "https://en.wikipedia.org/wiki/Uniform_Resource_Locator",
  "https://sub.deep.example.co.uk/a/b/c?d=e",
  "https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0JKLMNOPQRSTUV/view",
  "https://example.com/" + "ab/".repeat(120),
  "https://example.com/ALLCAPSPATHSEGMENTHERE",
  "https://example.com/日本語/каталог",
  "https://user:pw@example.com/x",
  "mailto:someone@example.com",
  "tel:+15551234567",
  "ftp://files.example.org/pub/thing.tar.gz",
  "magnet:?xt=urn:btih:abcdef0123456789",
  "https://t.me/somechannel/1234",
  "https://www.t.me/somechannel",
  // Templated shapes: if the encoder ever stops seeing these, the oracle's
  // template candidate beats it and "never beaten" fails.
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://www.amazon.com/dp/B08N5WRWNW",
  "https://i.imgur.com/aB3dEfG.jpg",
  "https://x.com/someuser/status/1234567890123456789",
];

test("every alternative encoding decodes back to the same URL", async () => {
  // Without this, "a shorter candidate exists" would be meaningless: the
  // shortest candidate of all is one that decodes to the wrong place.
  for (const url of CASES) {
    const expected = parse(url).href;
    const candidates = await allCandidates(url);
    assert.ok(candidates.length >= 3, `${url} produced only ${candidates.length} candidates`);
    for (const candidate of candidates) {
      const actual = (await expand(candidate.payload)).href;
      assert.equal(actual, expected, `candidate "${candidate.how}" for ${url}`);
    }
  }
});

test("the encoder is never beaten by one of its own alternatives", async () => {
  for (const url of CASES) {
    const result = await checkOptimal(url);
    assert.ok(result.optimal,
      `${url}\n  encoder: ${result.actual.length} chars\n` +
      `  best:    ${result.best.length} chars via ${result.how}\n` +
      `  wasted:  ${result.wasted}`);
  }
});

test("the host dictionary is always worth using", async () => {
  // A dictionary index costs 8 bits. The shortest possible host in the table
  // would have to be under 2 characters to beat that, which no host is.
  const shortest = HOSTS.reduce((a, b) => (b.length < a.length ? b : a));
  assert.ok(shortest.length * 6 > 8,
    `${shortest} is short enough that the dictionary may cost more than it saves`);

  for (const host of HOSTS.slice(0, 40)) {
    const result = await checkOptimal(`https://${host}/some/path`);
    assert.ok(result.optimal, `${host}: ${result.wasted} chars wasted via ${result.how}`);
  }
});

test("a www host that is only in the dictionary unstripped is handled", async () => {
  // "www.google.com" is a dictionary entry; "google.com" is not. Stripping the
  // prefix first would lose the dictionary hit and make the link longer.
  const withWww = await shorten("https://www.google.com/search?q=x", { stripTracking: false });
  const result = await checkOptimal("https://www.google.com/search?q=x");
  assert.ok(result.optimal, `wasted ${result.wasted} chars via ${result.how}`);
  assert.equal((await expand(withWww)).href, "https://www.google.com/search?q=x");
});

test("real URLs are encoded optimally", { skip: hasCorpus() ? false : "no corpus" },
  async (t) => {
    // Brute force is ~12 encodings per URL, so this runs on a slice rather
    // than the whole corpus; the corpus test checks body-mode choice on all
    // of them, and this checks every choice on a sample.
    const limit = Number(process.env.CLENT_OPTIMALITY_LIMIT) || 4000;
    let checked = 0;
    const misses = [];

    // The one tolerated miss class: DEFLATE is not monotonic in input
    // length, so a longer body can occasionally compress a single character
    // smaller than the shortest body the encoder chose to deflate. Closing
    // it costs ~56% of encode throughput for a 1-character win on ~0.03% of
    // URLs, so it is bounded here instead: deflate-only, 1 character, rare.
    const deflateMargin = [];

    for await (const url of readCorpus(limit)) {
      let result;
      try {
        result = await checkOptimal(url);
      } catch {
        continue; // unparseable input is the corpus test's problem, not this one
      }
      checked++;
      if (result.optimal) continue;
      if (result.wasted === 1 && result.how.includes("deflate")) {
        deflateMargin.push(result);
      } else {
        misses.push(result);
      }
    }

    for (const miss of misses.slice(0, 10)) {
      t.diagnostic(`${miss.wasted} chars: ${miss.url} (best: ${miss.how})`);
    }
    assert.equal(misses.length, 0,
      `${misses.length} of ${checked} real URLs could have been encoded smaller`);
    assert.ok(deflateMargin.length <= checked * 0.001,
      `the deflate margin should be rare, got ${deflateMargin.length}/${checked}`);
    t.diagnostic(`${checked.toLocaleString()} real URLs; ` +
      `${deflateMargin.length} within the 1-char deflate margin, rest exactly optimal`);
  });
