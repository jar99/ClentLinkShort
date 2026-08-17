#!/usr/bin/env node
/**
 * Run the corpus through the codec and print what happened.
 *
 * Exits non-zero on any round-trip mismatch, and on any URL the encoder
 * encoded worse than one of its own alternatives.
 *
 * Usage:
 *   node tools/validate-corpus.mjs
 *   node tools/validate-corpus.mjs --limit 5000
 *   node tools/validate-corpus.mjs --origin "https://ex.co/#"
 *   node tools/validate-corpus.mjs --json
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  readCorpus, hasCorpus, emptyStats, check, percentile, mean, breakEven, DEFAULT_ORIGIN,
} from "./corpus.js";
import { ROOT } from "./bundle.js";

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const LIMIT = Number(value("limit", Infinity));
const ORIGIN = value("origin", DEFAULT_ORIGIN);
const AS_JSON = args.includes("--json");

if (!hasCorpus()) {
  console.error("No corpus found. Run: npm run corpus:fetch");
  process.exit(1);
}

const manifest = await readFile(path.join(ROOT, "corpus", "manifest.json"), "utf8")
  .then(JSON.parse).catch(() => ({}));

const stats = emptyStats();
const started = Date.now();
let n = 0;

for await (const url of readCorpus(LIMIT)) {
  await check(url, stats, { maxFailures: 25, origin: ORIGIN });
  if (!AS_JSON && ++n % 25000 === 0) {
    process.stdout.write(`\r  ${n.toLocaleString()} checked…`);
  }
}

const seconds = (Date.now() - started) / 1000;
const total = stats.checked;
const pct = (num, den) => (den ? (100 * num) / den : 0);

// The prefix is fixed overhead on every link, so the same codec looks very
// different on a long domain and a short one. Showing several makes the cost
// of the domain visible instead of hiding it in one average.
const PREFIXES = [
  ["this site", ORIGIN],
  ["short path on the same host", "https://jar99.github.io/l/#"],
  ["a short custom domain", "https://clent.link/#"],
  ["payload alone, no prefix", ""],
];
const prefixTable = PREFIXES.map(([label, prefix]) => ({
  label,
  prefix,
  length: prefix.length,
  ...breakEven(stats.pairs, prefix.length),
}));
const here = prefixTable[0];

const summary = {
  generated: manifest.generated ?? new Date().toISOString().slice(0, 10),
  corpusTotal: manifest.total ?? total,
  checked: total,
  skipped: stats.skipped,
  failures: stats.failures.length,
  suboptimal: stats.suboptimal.length,
  origin: ORIGIN,

  // Payload alone, against the input URL.
  payloadRatio: stats.inputBytes ? stats.payloadBytes / stats.inputBytes : 0,
  payloadShorterPct: pct(stats.payloadShorter, total),
  medianRatio: percentile(stats.ratios, 0.5),
  p90Ratio: percentile(stats.ratios, 0.9),

  // The whole link, which is what someone actually pastes.
  linkSavingsMean: mean(stats.linkSavings),
  linkSavingsMedian: percentile(stats.linkSavings, 0.5),
  linkShorterPct: pct(stats.linkShorter, total),
  bareShorterPct: pct(stats.bare.linkShorter, stats.bare.count),
  deepShorterPct: pct(stats.deep.linkShorter, stats.deep.count),
  bareCount: stats.bare.count,
  deepCount: stats.deep.count,
  deepSavingsMedian: percentile(stats.deep.savings, 0.5),
  deepSavingsMean: mean(stats.deep.savings),

  breakEvenLength: here.breakEven,
  prefixes: prefixTable.map(({ label, length, breakEven: point, shorterPct, medianSaving }) =>
    ({ label, length, breakEven: point, shorterPct, medianSaving })),

  modes: stats.modes,
  templatePct: pct(stats.modes.template, total),
  dictHitPct: pct(stats.dictHits, total),
  trackingPct: pct(stats.withTracking, total),
  trackingSavingPct: pct(stats.trackingSavedBytes, stats.trackingBaseBytes),
};

// Written every run so the page quotes measurements, not remembered numbers.
// Free of timings on purpose: CI diffs this against the committed copy.
await writeFile(path.join(ROOT, "corpus", "stats.json"),
  JSON.stringify(summary, null, 2) + "\n");

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const row = (label, text) => console.log(`${label.padEnd(13)}${text}`);
  console.log(`\r${" ".repeat(44)}\r`);

  row("Corpus", `${(manifest.total ?? total).toLocaleString()} URLs` +
    (manifest.generated ? ` (${manifest.generated})` : ""));
  row("Checked", `${total.toLocaleString()} in ${seconds.toFixed(1)}s ` +
    `(${Math.round(total / seconds).toLocaleString()}/s)`);
  row("Failures", `${stats.failures.length}   round-trip mismatches`);
  row("Suboptimal", `${stats.suboptimal.length}   encoded worse than an available alternative`);
  console.log();

  console.log("Savings, payload only, against the input URL");
  row("  size", `${(100 * summary.payloadRatio).toFixed(1)}% overall, ` +
    `median ${(100 * summary.medianRatio).toFixed(1)}%, p90 ${(100 * summary.p90Ratio).toFixed(1)}%`);
  row("  shorter", `${summary.payloadShorterPct.toFixed(1)}%`);
  console.log();

  console.log(`Savings, whole link, prefixed with ${ORIGIN}`);
  row("  mean", `${(100 * summary.linkSavingsMean).toFixed(1)}%`);
  row("  median", `${(100 * summary.linkSavingsMedian).toFixed(1)}%`);
  row("  shorter", `${summary.linkShorterPct.toFixed(1)}% of all URLs`);
  row("  deep links", `${summary.deepShorterPct.toFixed(1)}% shorter, ` +
    `median saving ${(100 * summary.deepSavingsMedian).toFixed(1)}% ` +
    `(${stats.deep.count.toLocaleString()} URLs)`);
  row("  bare hosts", `${summary.bareShorterPct.toFixed(1)}% shorter ` +
    `(${stats.bare.count.toLocaleString()} URLs)`);
  console.log();

  console.log("How long a URL must be before the whole link is shorter");
  for (const entry of prefixTable) {
    console.log(`  ${String(entry.length).padStart(2)}c prefix  ` +
      `break-even ${String(entry.breakEven ?? "never").padStart(5)}  ` +
      `shorter ${entry.shorterPct.toFixed(1).padStart(5)}%  ${entry.label}`);
  }
  console.log();

  row("Dictionary", `${summary.dictHitPct.toFixed(1)}% of hosts`);
  row("Templates", `${summary.templatePct.toFixed(1)}% of URLs matched one`);
  row("Tracking", `${summary.trackingPct.toFixed(2)}% of URLs carried any; ` +
    `stripping saves ${summary.trackingSavingPct.toFixed(1)}% on those`);
  console.log();

  console.log("Winning body mode");
  for (const [mode, count] of Object.entries(stats.modes)) {
    console.log(`  ${mode.padEnd(9)} ${String(count).padStart(8)}  ${pct(count, total).toFixed(1)}%`);
  }

  for (const [label, list] of [["Failures", stats.failures], ["Suboptimal", stats.suboptimal]]) {
    if (!list.length) continue;
    console.log(`\n${label}`);
    for (const item of list.slice(0, 15)) {
      console.log(`  ${item.reason ?? `${item.wasted} chars wasted`}: ${item.url}`);
      if (item.detail) console.log(`    ${item.detail}`);
    }
  }
}

process.exit(stats.failures.length || stats.suboptimal.length ? 1 : 0);
