#!/usr/bin/env node
/**
 * Build the validation corpus.
 *
 * Writes two files:
 *   corpus/urls.txt.br    real URLs, shuffled, for round-trip validation
 *   corpus/ranks.txt.br   the Tranco top-1M domains in rank order, used to
 *                         measure how much of the web the corpus reaches and
 *                         to sweep every ranked domain through the codec
 *
 * Usage:
 *   node tools/fetch-corpus.mjs
 *   node tools/fetch-corpus.mjs --count 500000
 *   node tools/fetch-corpus.mjs --source wikipedia --count 50000
 *   node tools/fetch-corpus.mjs --skip-ranks
 */

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { brotliCompressSync, constants } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path";

import { ROOT } from "./bundle.js";
import { readLines } from "./corpus.js";
import {
  wikipedia, hackernews, hncomments, gdelt, stackexchange, trancoDomains,
  feeds, lemmy, commons, reddit, mastodon, fandom, targeted,
  crossref, npmjs, pypi, archiveitems, googlenews,
} from "./sources.js";

const OUT = path.join(ROOT, "corpus");
const UA = "clent-corpus/2.1 (+https://github.com/jar99/ClentLinkShort)";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const TOTAL = Number(flag("count", 500000));
const ONLY = flag("source", null); // one name, or a comma-separated list
const SKIP_RANKS = args.includes("--skip-ranks");
const REFRESH_RANKS = args.includes("--refresh-ranks");
// Union with the existing corpus instead of replacing it: top-up runs add
// new sources' URLs without refetching everything already collected.
const MERGE = args.includes("--merge");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with retries; public APIs rate-limit and a run makes thousands of calls. */
async function request(url, { json = true, retries = 4 } = {}) {
  let wait = 1200;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": UA, accept: json ? "application/json" : "*/*" },
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return json ? await response.json() : response;
    } catch (error) {
      if (attempt >= retries) throw error;
      await sleep(wait);
      wait = Math.min(wait * 2, 20000);
    }
  }
}

// Sources run concurrently, so carriage-return progress lines would fight
// over the same terminal row; a quiet milestone line per 100k keeps the log
// readable from several writers at once.
const progress = (label, n, target) => {
  if (n && n % 100000 === 0) {
    const pct = target ? ` (${Math.min(100, Math.round((100 * n) / target))}%)` : "";
    console.log(`  …${label} ${n.toLocaleString()}${pct}`);
  }
};

const context = { get: request, progress, sleep };

/* -------------------------------------------------------------------------- *
 * Tranco ranks
 * -------------------------------------------------------------------------- */

/** @returns {Promise<string[]>} domains in rank order, index 0 = rank 1 */
async function fetchRanks() {
  // Re-download only when asked: the list is 22 MB and changes daily, and a
  // corpus rebuild should not be gated on it.
  const cached = path.join(OUT, "ranks.txt.br");
  if (!REFRESH_RANKS && existsSync(cached)) {
    const domains = [];
    for await (const domain of readLines(cached)) domains.push(domain);
    console.log(`  tranco         ${domains.length.toLocaleString()} ranked domains (cached)`);
    return domains;
  }

  process.stdout.write("  tranco         resolving latest list…");
  const meta = await request("https://tranco-list.eu/api/lists/date/latest");
  if (!meta?.download) throw new Error("Tranco did not return a download URL");

  const response = await request(meta.download, { json: false });
  const csv = await response.text();
  const domains = [];
  for (const line of csv.split("\n")) {
    const domain = line.slice(line.indexOf(",") + 1).trim();
    if (domain && !domain.includes(",")) domains.push(domain);
  }
  process.stdout.write(`\r  tranco         ${domains.length.toLocaleString()} ranked domains   \n`);
  return domains;
}

/* -------------------------------------------------------------------------- *
 * Collection
 * -------------------------------------------------------------------------- */

/** Keep what the codec claims to handle; drop what a URL parser rejects outright. */
function usable(raw) {
  if (typeof raw !== "string") return null;
  let url = raw.trim();
  if (!url || url.length > 4000) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/[\s<>"]/.test(url)) return null;
  // Links lifted out of prose and code drag punctuation along with them.
  url = url.replace(/[).,;'\]]+$/, "");
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes(".")) return null;
  } catch {
    return null;
  }
  return url;
}

const brotli = (text, quality = 9) => brotliCompressSync(Buffer.from(text), {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: quality,
    [constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(text),
  },
});

/**
 * Deterministically shuffle and write the collected set — atomically, via a
 * temp file and rename, so a checkpoint interrupted mid-write can never
 * leave a truncated corpus behind. Called every couple of minutes while
 * sources run and once at the end: a killed run resumes from its last
 * checkpoint with --merge instead of starting over.
 */
async function persist(seen, quality) {
  const { rename } = await import("node:fs/promises");
  const all = [...seen];
  let state = 0x9e3779b9;
  for (let i = all.length - 1; i > 0; i--) {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    [all[i], all[state % (i + 1)]] = [all[state % (i + 1)], all[i]];
  }
  const text = all.join("\n") + "\n";
  const file = path.join(OUT, "urls.txt.br");
  await writeFile(file + ".tmp", brotli(text, quality));
  await rename(file + ".tmp", file);
  return { count: all.length, bytes: text.length, text };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Collecting ~${TOTAL.toLocaleString()} real URLs\n`);

  let ranks = [];
  if (!SKIP_RANKS) {
    try {
      ranks = await fetchRanks();
      if (REFRESH_RANKS || !existsSync(path.join(OUT, "ranks.txt.br"))) {
        await writeFile(path.join(OUT, "ranks.txt.br"), brotli(ranks.join("\n") + "\n"));
      }
    } catch (error) {
      console.warn(`  ! tranco unavailable: ${error.message}`);
    }
  }

  // Deep links are what people actually shorten, so they dominate. Ranked
  // domains are included too, spread across the whole rank range, so the
  // corpus is not made only of what a handful of link aggregators surface.
  // The mix is weighted towards what people actually shorten. Wikipedia and
  // Hacker News were the whole corpus once and are citation- and tech-heavy;
  // lemmy, feeds and commons exist to drag it towards shopping, news, social
  // posts and image shares, which have completely different URL shapes.
  //
  // gdelt and stackexchange are reachable but absent by default: both
  // rate-limit a scripted run hard enough to cost minutes for a rounding
  // error's worth of corpus. Both stay available via --source.
  // Shares reflect what each source can actually deliver, not what would be
  // tidy: lemmy and the feeds are shallow and will fall short of their target,
  // which is fine — they are here for the shapes they contribute, not volume.
  const plan = {
    wikipedia: 0.34,
    tranco: 0.32,
    hackernews: 0.17,
    commons: 0.16,
    lemmy: 0.005,
    feeds: 0.005,
  };
  const generators = {
    wikipedia: (n) => wikipedia(n, context),
    hackernews: (n) => hackernews(n, context),
    gdelt: (n) => gdelt(n, context),
    stackexchange: (n) => stackexchange(n, context),
    feeds: (n) => feeds(n, context),
    lemmy: (n) => lemmy(n, context),
    commons: (n) => commons(n, context),
    reddit: (n) => reddit(n, context),
    mastodon: (n) => mastodon(n, context),
    fandom: (n) => fandom(n, context),
    targeted: (n) => targeted(n, context),
    hncomments: (n) => hncomments(n, context),
    crossref: (n) => crossref(n, context),
    npmjs: (n) => npmjs(n, context),
    pypi: (n) => pypi(n, context),
    archiveitems: (n) => archiveitems(n, context),
    googlenews: (n) => googlenews(n, context),
    tranco: (n) => trancoDomains(n, ranks),
  };

  const only = ONLY ? ONLY.split(",").map((name) => name.trim()) : null;
  const wanted = only
    ? Object.fromEntries(only.map((name) => [name, 1 / only.length]))
    : plan;
  for (const name of Object.keys(wanted)) {
    if (!generators[name]) {
      console.error(`Unknown source "${name}". Known: ${Object.keys(generators).join(", ")}`);
      process.exit(1);
    }
  }

  const seen = new Set();
  const counts = {};

  if (MERGE && existsSync(path.join(OUT, "urls.txt.br"))) {
    for await (const line of readLines(path.join(OUT, "urls.txt.br"))) seen.add(line);
    counts.existing = seen.size;
    console.log(`  existing       ${seen.size.toLocaleString()} URLs merged in`);
  }

  // All sources at once: the run takes as long as its slowest source, not
  // the sum of them. The shared dedup set is safe — generators only hand
  // over between awaits, and Node runs this on one thread.
  /** Per-source honesty: what arrived, what was junk, what was already seen. */
  const quality = {};

  // Checkpoint while collecting: every two minutes the union so far lands
  // on disk atomically, so a crash or a kill loses at most two minutes and
  // the next --merge run resumes from where this one got to.
  let lastSaved = seen.size;
  const checkpointer = setInterval(async () => {
    if (seen.size === lastSaved) return;
    lastSaved = seen.size;
    const saved = await persist(seen, 5); // fast compression for checkpoints
    console.log(`  …checkpoint ${saved.count.toLocaleString()} URLs saved`);
  }, 120000);

  await Promise.all(Object.entries(wanted).map(async ([name, share]) => {
    const target = Math.round(TOTAL * share);
    counts[name] = 0;
    const q = quality[name] = { kept: 0, duplicates: 0, rejected: 0 };
    const started = Date.now();
    try {
      for await (const raw of generators[name](Math.round(target * 1.3))) {
        const url = usable(raw);
        if (!url) { q.rejected++; continue; }
        if (seen.has(url)) { q.duplicates++; continue; }
        seen.add(url);
        q.kept++;
        if (++counts[name] >= target) break;
      }
    } catch (error) {
      console.warn(`  ! ${name} stopped early: ${error.message}`);
    }
    console.log(`  ${name.padEnd(14)} ${counts[name].toLocaleString()} URLs in ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s` +
      ` (${q.duplicates.toLocaleString()} dupes, ${q.rejected.toLocaleString()} rejected)`);
  }));

  clearInterval(checkpointer);

  // The final write: shuffled deterministically so reading the first N
  // lines still gives a representative mix rather than one source's block.
  const { count, bytes, text } = await persist(seen, 9);
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    total: count,
    counts,
    quality,
    rankedDomains: ranks.length,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes,
    sources: {
      wikipedia: "{lang}.wikipedia.org exturlusage, 40 editions — cited links",
      hackernews: "hn.algolia.com search_by_date, stories — submitted links",
      hncomments: "hn.algolia.com search_by_date, comments — links in conversation",
      lemmy: "8 Lemmy instances, /api/v3/post/list — social, news, deals, images",
      feeds: "50 RSS/Atom feeds — news, deals, newsletters, youtube channels",
      googlenews: "news.google.com/rss, 6 locales x 9 sections",
      commons: "commons.wikimedia.org allimages — image shares",
      reddit: "reddit.com listing feeds — submitted links and permalinks",
      mastodon: "16 instances, /api/v1/timelines/public — posts, cards, body links",
      fandom: "39 Fandom wikis, allpages — real article URLs",
      targeted: "en.wikipedia exturlusage?euquery per asked-for domain",
      crossref: "api.crossref.org/works — DOI links",
      npmjs: "replicate.npmjs.com — package pages",
      pypi: "pypi.org/simple — project pages, sampled across the index",
      archiveitems: "archive.org/advancedsearch — item pages, 5 media types",
      gdelt: "api.gdeltproject.org/api/v2/doc/doc",
      stackexchange: "api.stackexchange.com/2.3/questions?filter=withbody",
      tranco: "tranco-list.eu — ranked domains, sampled across the full range",
    },
  }, null, 2) + "\n");

  console.log(`\n${count.toLocaleString()} unique URLs`);
  console.log(`${(bytes / 1e6).toFixed(1)} MB raw`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
