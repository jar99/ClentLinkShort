#!/usr/bin/env node
/**
 * Run the full corpus through the codec and print a report.
 *
 * Exits non-zero on any round-trip mismatch — a link that resolves to the
 * wrong destination is the one failure mode that must never ship.
 *
 * Usage:
 *   node tools/validate-corpus.mjs              # whole corpus
 *   node tools/validate-corpus.mjs --limit 5000
 *   node tools/validate-corpus.mjs --json       # machine-readable summary
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readCorpus, hasCorpus, emptyStats, check, percentile, ROOT } from "./corpus.js";

const args = process.argv.slice(2);
const at = args.indexOf("--limit");
const LIMIT = at === -1 ? Infinity : Number(args[at + 1]);
const AS_JSON = args.includes("--json");

if (!hasCorpus()) {
  console.error("No corpus found. Run: npm run corpus:fetch");
  process.exit(1);
}

const manifest = await readFile(path.join(ROOT, "corpus", "manifest.json"), "utf8")
  .then(JSON.parse)
  .catch(() => ({}));

const stats = emptyStats();
const started = Date.now();
let n = 0;

for await (const url of readCorpus(LIMIT)) {
  await check(url, stats, { maxFailures: 25 });
  if (!AS_JSON && ++n % 10000 === 0) {
    process.stdout.write(`\r  ${n.toLocaleString()} checked…`);
  }
}

const seconds = (Date.now() - started) / 1000;
const pct = (num, den) => den ? ((100 * num) / den).toFixed(1) + "%" : "—";

const summary = {
  generated: manifest.generated ?? new Date().toISOString().slice(0, 10),
  corpus: manifest.generated ? `${manifest.total?.toLocaleString()} URLs (${manifest.generated})` : "local",
  checked: stats.checked,
  skipped: stats.skipped,
  failures: stats.failures.length,
  shorterPct: stats.checked ? (100 * stats.shorter) / stats.checked : 0,
  overallRatio: stats.inputBytes ? stats.payloadBytes / stats.inputBytes : 0,
  medianRatio: percentile(stats.ratios, 0.5),
  p90Ratio: percentile(stats.ratios, 0.9),
  modes: stats.modes,
  dictHitPct: stats.checked ? (100 * stats.dictHits) / stats.checked : 0,
  trackingPct: stats.checked ? (100 * stats.trackingStripped) / stats.checked : 0,
};

// Written on every run so the homepage quotes measurements rather than
// remembered numbers; the build reads this file and fails without it.
// Deliberately free of timings: CI diffs this file against the committed copy
// to prove the numbers on the page are the numbers the codec actually scores.
await writeFile(path.join(ROOT, "corpus", "stats.json"),
  JSON.stringify(summary, null, 2) + "\n");

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const total = stats.checked;
  console.log(`\r${" ".repeat(40)}\r`);
  console.log(`Corpus       ${summary.corpus}`);
  console.log(`Checked      ${total.toLocaleString()} URLs in ${seconds.toFixed(1)}s ` +
    `(${Math.round(total / seconds).toLocaleString()}/s)`);
  console.log(`Skipped      ${stats.skipped.toLocaleString()} (rejected by the URL parser)`);
  console.log(`Failures     ${stats.failures.length}`);
  console.log();
  console.log(`Round-trip   ${pct(total, total + stats.failures.length)} exact`);
  console.log(`Shorter      ${summary.shorterPct.toFixed(1)}% of payloads beat their input URL`);
  console.log(`Size         ${(100 * summary.overallRatio).toFixed(1)}% of input overall, ` +
    `median ${(100 * summary.medianRatio).toFixed(1)}%, p90 ${(100 * summary.p90Ratio).toFixed(1)}%`);
  console.log(`Dictionary   ${summary.dictHitPct.toFixed(1)}% of hosts hit the table`);
  console.log(`Tracking     ${summary.trackingPct.toFixed(1)}% carried parameters worth stripping`);
  console.log();
  console.log("Winning mode");
  for (const [mode, count] of Object.entries(stats.modes)) {
    console.log(`  ${mode.padEnd(9)} ${String(count).padStart(8)}  ${pct(count, total)}`);
  }

  if (stats.failures.length) {
    console.log("\nFailures");
    for (const failure of stats.failures) {
      console.log(`  ${failure.reason}: ${failure.url}`);
      if (failure.detail) console.log(`    ${failure.detail}`);
    }
  }
}

process.exit(stats.failures.length ? 1 : 0);
