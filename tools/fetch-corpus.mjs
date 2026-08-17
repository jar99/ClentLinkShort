#!/usr/bin/env node
/**
 * Build a corpus of real URLs for validation.
 *
 * Synthetic URLs only prove the codec handles what its author imagined. Real
 * ones are messier: doubled slashes, unencoded spaces, mojibake, 2 KB of query
 * string, session IDs, punycode, ports, and every kind of trailing punctuation.
 * Those are what actually break a codec, so that is what we test against.
 *
 * Sources, chosen because they are public, paginate, and are wildly different
 * from each other:
 *
 *   wikipedia  external links cited in articles — academic, government, news,
 *              PDFs, and a long tail of ancient hand-typed URLs
 *   hn         links submitted to Hacker News — the actual use case for a
 *              shortener, skewed modern and heavy on query strings
 *   majestic   the Majestic Million domain ranking — bare hosts, which is the
 *              hardest case for a shortener to beat
 *
 * Usage:
 *   node tools/fetch-corpus.mjs                 # default mix, writes corpus/
 *   node tools/fetch-corpus.mjs --count 300000  # bigger
 *   node tools/fetch-corpus.mjs --source hn     # one source only
 */

import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "corpus");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const TOTAL = Number(flag("count", 150000));
const ONLY = flag("source", null);
const UA = "clent-corpus/2.0 (+https://github.com/jar99/ClentLinkShort)";

/* -------------------------------------------------------------------------- */

/**
 * Fetch with retries and exponential backoff. Public APIs rate-limit, and a
 * corpus run makes hundreds of requests.
 */
async function get(url, { retries = 5, json = true } = {}) {
  let wait = 1000;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": UA, accept: json ? "application/json" : "*/*" },
        signal: AbortSignal.timeout(90000),
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return json ? await response.json() : response;
    } catch (error) {
      if (attempt >= retries) throw error;
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 2, 30000);
    }
  }
}

const progress = (label, n, target) => {
  const pct = target ? ` ${Math.min(100, Math.round((100 * n) / target))}%` : "";
  process.stdout.write(`\r  ${label.padEnd(10)} ${String(n).padStart(7)}${pct}   `);
};

/* -------------------------------------------------------------------------- *
 * Sources
 * -------------------------------------------------------------------------- */

/** External links cited across English Wikipedia articles. */
async function* wikipedia(target) {
  let cont = "";
  let seen = 0;
  while (seen < target) {
    const url = "https://en.wikipedia.org/w/api.php?action=query&list=exturlusage" +
      "&eulimit=500&format=json&formatversion=2" +
      (cont ? `&eucontinue=${encodeURIComponent(cont)}` : "");
    const body = await get(url);
    const rows = body?.query?.exturlusage ?? [];
    if (!rows.length) return;
    for (const row of rows) {
      if (row.url) { yield row.url; seen++; }
    }
    progress("wikipedia", seen, target);
    cont = body?.continue?.eucontinue;
    if (!cont) return;
  }
}

/**
 * Links submitted to Hacker News. Algolia caps a query at 1000 hits, so walk
 * backwards through time using the oldest timestamp of each page as the next
 * upper bound.
 */
async function* hackernews(target) {
  let before = Math.floor(Date.now() / 1000);
  let seen = 0;
  while (seen < target) {
    const url = "https://hn.algolia.com/api/v1/search_by_date?tags=story" +
      `&hitsPerPage=1000&numericFilters=created_at_i<${before}`;
    const body = await get(url);
    const hits = body?.hits ?? [];
    if (!hits.length) return;
    for (const hit of hits) {
      if (hit.url) { yield hit.url; seen++; }
    }
    progress("hn", seen, target);
    const oldest = Math.min(...hits.map((h) => h.created_at_i).filter(Number.isFinite));
    if (!Number.isFinite(oldest) || oldest >= before) return;
    before = oldest;
  }
}

/** Bare domains from the Majestic Million ranking, streamed out of the CSV. */
async function* majestic(target) {
  const response = await get("https://downloads.majestic.com/majestic_million.csv",
    { json: false });
  let seen = 0;
  let carry = "";
  let header = true;
  for await (const chunk of response.body) {
    carry += Buffer.from(chunk).toString("latin1");
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const line of lines) {
      if (header) { header = false; continue; }
      const domain = line.split(",")[2];
      if (!domain) continue;
      yield `https://${domain}/`;
      if (++seen >= target) { progress("majestic", seen, target); return; }
    }
    progress("majestic", seen, target);
  }
}

const SOURCES = {
  wikipedia: { fn: wikipedia, share: 0.4 },
  hn: { fn: hackernews, share: 0.3 },
  majestic: { fn: majestic, share: 0.3 },
};

/* -------------------------------------------------------------------------- *
 * Collection
 * -------------------------------------------------------------------------- */

/** Keep anything the codec claims to accept; reject only what it cannot parse. */
function usable(raw) {
  if (typeof raw !== "string") return null;
  const url = raw.trim();
  if (!url || url.length > 4000) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (/[\s\n\r\t]/.test(url)) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return url;
}

async function main() {
  const wanted = ONLY ? { [ONLY]: { ...SOURCES[ONLY], share: 1 } } : SOURCES;
  if (ONLY && !SOURCES[ONLY]) {
    console.error(`Unknown source "${ONLY}". Known: ${Object.keys(SOURCES).join(", ")}`);
    process.exit(1);
  }

  console.log(`Collecting ~${TOTAL.toLocaleString()} real URLs\n`);
  const seen = new Set();
  const counts = {};

  for (const [name, { fn, share }] of Object.entries(wanted)) {
    const target = Math.round(TOTAL * share);
    counts[name] = 0;
    const started = Date.now();
    try {
      for await (const raw of fn(Math.round(target * 1.15))) {
        const url = usable(raw);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        if (++counts[name] >= target) break;
      }
    } catch (error) {
      process.stdout.write("\n");
      console.warn(`  ! ${name} stopped early: ${error.message}`);
    }
    process.stdout.write("\n");
    console.log(`  ${name.padEnd(10)} ${counts[name].toLocaleString()} URLs ` +
      `in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  // Shuffle deterministically so that reading only the first N lines still
  // gives a representative mix of all three sources.
  const all = [...seen];
  let state = 0x9e3779b9;
  for (let i = all.length - 1; i > 0; i--) {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    const j = state % (i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }

  await mkdir(OUT_DIR, { recursive: true });
  const text = all.join("\n") + "\n";
  const file = path.join(OUT_DIR, "urls.txt.gz");
  await pipeline(Readable.from([text]), createGzip({ level: 9 }), createWriteStream(file));

  const manifest = {
    generated: new Date().toISOString().slice(0, 10),
    total: all.length,
    counts,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: text.length,
    sources: {
      wikipedia: "en.wikipedia.org/w/api.php?action=query&list=exturlusage",
      hn: "hn.algolia.com/api/v1/search_by_date?tags=story",
      majestic: "downloads.majestic.com/majestic_million.csv",
    },
  };
  await writeFile(path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");

  const { statSync } = await import("node:fs");
  console.log(`\n${all.length.toLocaleString()} unique URLs -> ${file}`);
  console.log(`${(text.length / 1e6).toFixed(1)} MB raw, ` +
    `${(statSync(file).size / 1e6).toFixed(1)} MB gzipped`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
