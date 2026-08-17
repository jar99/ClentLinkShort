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
import { wikipedia, hackernews, gdelt, stackexchange, trancoDomains } from "./sources.js";

const OUT = path.join(ROOT, "corpus");
const UA = "clent-corpus/2.1 (+https://github.com/jar99/ClentLinkShort)";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const TOTAL = Number(flag("count", 500000));
const ONLY = flag("source", null);
const SKIP_RANKS = args.includes("--skip-ranks");
const REFRESH_RANKS = args.includes("--refresh-ranks");

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

const progress = (label, n, target) => {
  const pct = target ? ` ${Math.min(100, Math.round((100 * n) / target))}%` : "";
  process.stdout.write(`\r  ${label.padEnd(14)} ${String(n).padStart(7)}${pct}   `);
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

const brotli = (text) => brotliCompressSync(Buffer.from(text), {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 11,
    [constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(text),
  },
});

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
  // gdelt and stackexchange are deliberately absent: both are reachable but
  // rate-limit a scripted run hard enough that they cost minutes for a couple
  // of percent of the corpus. They stay available via --source for anyone who
  // wants them. Wikipedia across 30 language editions already reaches further
  // into the web than either.
  const plan = {
    wikipedia: 0.50,
    hackernews: 0.28,
    tranco: 0.22,
  };
  const generators = {
    wikipedia: (n) => wikipedia(n, context),
    hackernews: (n) => hackernews(n, context),
    gdelt: (n) => gdelt(n, context),
    stackexchange: (n) => stackexchange(n, context),
    tranco: (n) => trancoDomains(n, ranks),
  };

  const wanted = ONLY ? { [ONLY]: 1 } : plan;
  if (ONLY && !generators[ONLY]) {
    console.error(`Unknown source "${ONLY}". Known: ${Object.keys(generators).join(", ")}`);
    process.exit(1);
  }

  const seen = new Set();
  const counts = {};

  for (const [name, share] of Object.entries(wanted)) {
    const target = Math.round(TOTAL * share);
    counts[name] = 0;
    const started = Date.now();
    try {
      for await (const raw of generators[name](Math.round(target * 1.3))) {
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
    console.log(`  ${name.padEnd(14)} ${counts[name].toLocaleString()} URLs in ` +
      `${((Date.now() - started) / 1000).toFixed(0)}s`);
  }

  // Shuffle deterministically so reading the first N lines still gives a
  // representative mix rather than one source's block.
  const all = [...seen];
  let state = 0x9e3779b9;
  for (let i = all.length - 1; i > 0; i--) {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    [all[i], all[state % (i + 1)]] = [all[state % (i + 1)], all[i]];
  }

  const text = all.join("\n") + "\n";
  const packed = brotli(text);
  await writeFile(path.join(OUT, "urls.txt.br"), packed);
  await writeFile(path.join(OUT, "manifest.json"), JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    total: all.length,
    counts,
    rankedDomains: ranks.length,
    sha256: createHash("sha256").update(text).digest("hex"),
    bytes: text.length,
    sources: {
      wikipedia: "{lang}.wikipedia.org/w/api.php?action=query&list=exturlusage, 30 editions",
      hackernews: "hn.algolia.com/api/v1/search_by_date?tags=story",
      gdelt: "api.gdeltproject.org/api/v2/doc/doc",
      stackexchange: "api.stackexchange.com/2.3/questions?filter=withbody",
      tranco: "tranco-list.eu — ranked domains, sampled across the full range",
    },
  }, null, 2) + "\n");

  console.log(`\n${all.length.toLocaleString()} unique URLs`);
  console.log(`${(text.length / 1e6).toFixed(1)} MB raw, ` +
    `${(packed.length / 1e6).toFixed(1)} MB brotli`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
