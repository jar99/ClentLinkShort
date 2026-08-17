#!/usr/bin/env node
/**
 * How much of the web does the corpus actually reach, and does the codec
 * handle all of it?
 *
 * Two separate questions, answered separately:
 *
 *   Reach     what share of ranked web traffic the corpus's domains represent
 *   Sweep     whether every domain in the Tranco top 1M round-trips
 *
 * On "covering 95% of the internet": there is no way to measure that, and
 * anyone claiming a hard number for it is guessing. What can be measured is
 * coverage of a published ranking. Tranco ranks a million domains by
 * popularity; mapping each corpus URL onto that list gives a real coverage
 * figure, and the sweep proves the codec works on every ranked domain rather
 * than only the ones the corpus happened to sample.
 *
 * Turning a rank into a share of traffic needs a model, because nobody
 * publishes per-domain traffic. Web popularity is roughly Zipfian, so the
 * weight of rank r is taken as 1/r^s. The exponent is reported alongside the
 * result and can be changed, because the answer depends on it: a steeper
 * exponent concentrates traffic in the head and flatters the number.
 *
 * Usage:
 *   node tools/coverage.mjs
 *   node tools/coverage.mjs --exponent 1.2
 *   node tools/coverage.mjs --sweep          # round-trip all 1M ranked domains
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { readCorpus, readRanks, hasCorpus, hasRanks } from "./corpus.js";
import { ROOT } from "./bundle.js";
import { shorten, expand } from "../src/clent.js";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const EXPONENT = Number(value("exponent", 1.0));
const SWEEP = args.includes("--sweep");

if (!hasCorpus() || !hasRanks()) {
  console.error("Need corpus/urls.txt.br and corpus/ranks.txt.br. Run: npm run corpus:fetch");
  process.exit(1);
}

/* -------------------------------------------------------------------------- *
 * Ranked domains
 * -------------------------------------------------------------------------- */

process.stdout.write("Loading ranked domains… ");
/** @type {Map<string, number>} domain -> rank, 1-based */
const rank = new Map();
/** @type {string[]} */
const byRank = [];
for await (const domain of readRanks()) {
  if (!rank.has(domain)) {
    byRank.push(domain);
    rank.set(domain, byRank.length);
  }
}
console.log(`${byRank.length.toLocaleString()}`);

/**
 * Find which ranked domain a hostname belongs to.
 *
 * This sidesteps needing a public suffix list: walk the hostname's suffixes
 * from longest to shortest and take the first that is ranked. `news.bbc.co.uk`
 * tries `news.bbc.co.uk`, then `bbc.co.uk` — which is in the list — and stops
 * before it can wrongly land on `co.uk`.
 */
function rankedDomain(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const suffix = labels.slice(i).join(".");
    if (rank.has(suffix)) return suffix;
  }
  return null;
}

/* -------------------------------------------------------------------------- *
 * Reach
 * -------------------------------------------------------------------------- */

const hit = new Set();
let urls = 0, matched = 0;
const unrankedHosts = new Set();

for await (const url of readCorpus()) {
  urls++;
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    continue;
  }
  const domain = rankedDomain(hostname);
  if (domain) {
    hit.add(domain);
    matched++;
  } else if (unrankedHosts.size < 500000) {
    unrankedHosts.add(hostname);
  }
  if (urls % 100000 === 0) process.stdout.write(`\r  ${urls.toLocaleString()} URLs mapped…`);
}
process.stdout.write(`\r${" ".repeat(40)}\r`);

// Zipf weights: mass of rank r is 1/r^s, normalised over the whole list.
let totalMass = 0;
let coveredMass = 0;
for (let r = 1; r <= byRank.length; r++) {
  const weight = 1 / Math.pow(r, EXPONENT);
  totalMass += weight;
  if (hit.has(byRank[r - 1])) coveredMass += weight;
}

const tiers = [1000, 10000, 100000, 1000000].filter((n) => n <= byRank.length);
const tierCoverage = tiers.map((n) => {
  let covered = 0;
  for (let r = 1; r <= n; r++) if (hit.has(byRank[r - 1])) covered++;
  return { top: n, covered, pct: (100 * covered) / n };
});

console.log(`Corpus            ${urls.toLocaleString()} URLs`);
console.log(`Ranked domains    ${hit.size.toLocaleString()} of ${byRank.length.toLocaleString()} present`);
console.log(`URLs on a ranked domain  ${((100 * matched) / urls).toFixed(1)}%`);
console.log(`Unranked hosts    ${unrankedHosts.size.toLocaleString()} distinct — the tail beyond the top 1M`);
console.log();
console.log("Coverage of each rank tier");
for (const tier of tierCoverage) {
  console.log(`  top ${String(tier.top).padStart(9)}  ${tier.covered.toLocaleString().padStart(9)}  ` +
    `${tier.pct.toFixed(1)}%`);
}
console.log();
console.log(`Traffic-weighted reach, Zipf s=${EXPONENT}:  ` +
  `${((100 * coveredMass) / totalMass).toFixed(1)}%`);
console.log("  (a model, not a measurement — no one publishes per-domain traffic)");

/* -------------------------------------------------------------------------- *
 * Sweep
 * -------------------------------------------------------------------------- */

let sweep = null;
if (SWEEP) {
  console.log("\nSweeping every ranked domain through the codec…");
  let checked = 0, failed = 0, shorter = 0;
  const examples = [];

  for (const domain of byRank) {
    const url = `https://${domain}/`;
    try {
      const payload = await shorten(url, { stripTracking: false });
      const back = await expand(payload);
      if (back.href !== url) {
        failed++;
        if (examples.length < 10) examples.push(`${url} -> ${back.href}`);
      } else if (payload.length < url.length) {
        shorter++;
      }
    } catch (error) {
      failed++;
      if (examples.length < 10) examples.push(`${url} -> ${error.message}`);
    }
    if (++checked % 100000 === 0) {
      process.stdout.write(`\r  ${checked.toLocaleString()}…`);
    }
  }
  process.stdout.write(`\r${" ".repeat(30)}\r`);
  console.log(`  ${checked.toLocaleString()} domains, ${failed} failures`);
  console.log(`  ${((100 * shorter) / checked).toFixed(1)}% had a payload shorter than the URL`);
  for (const example of examples) console.log(`    ${example}`);
  sweep = { checked, failed, shorterPct: (100 * shorter) / checked };
}

await writeFile(path.join(ROOT, "corpus", "coverage.json"), JSON.stringify({
  urls,
  rankedDomainsPresent: hit.size,
  rankedDomainsTotal: byRank.length,
  urlsOnRankedDomainPct: (100 * matched) / urls,
  unrankedHosts: unrankedHosts.size,
  tiers: tierCoverage,
  zipfExponent: EXPONENT,
  weightedReachPct: (100 * coveredMass) / totalMass,
  sweep,
}, null, 2) + "\n");

process.exit(sweep && sweep.failed ? 1 : 0);
