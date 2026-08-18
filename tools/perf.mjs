#!/usr/bin/env node
/**
 * What the page actually costs to load, measured rather than guessed.
 *
 * The interesting number is not the transfer size — it is the time from
 * navigation to the moment a redirect could fire, on the kind of CPU people
 * actually hold. So the harness throttles the CPU, loads a real short link,
 * and reads Chrome's own script/style/layout durations back through the
 * DevTools protocol.
 *
 *   node tools/perf.mjs                 # dist, 4x slowdown, 7 runs
 *   node tools/perf.mjs src --cpu 1
 *
 * Two paths are timed separately, because they are different pages:
 *   redirect — opening a link. Nothing matters except reaching the destination.
 *   create   — the maker. First paint and interactivity matter instead.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { shorten } from "../src/clent.js";
import { ports } from "../clent.config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DIR = args.find((a) => !a.startsWith("--")) ?? "dist";
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(args[i + 1]);
};
const CPU = flag("cpu", 4);
/**
 * Localhost delivers the whole document in one chunk, so the parser never
 * yields and every "did we wait for the end of the document" question answers
 * itself with "there was no waiting". Throttling makes the document stream the
 * way it does for real people, which is the only condition under which
 * rendering early is worth anything. Defaults are Lighthouse's mobile profile.
 */
const NET = args.includes("--fast") ? null : {
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};
const RUNS = flag("runs", 7);
const PORT = Number(process.env.PORT || ports.test) + 3;
const BASE = `http://localhost:${PORT}/`;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright");
  process.exit(2);
}

const server = spawn(process.execPath,
  [path.join(ROOT, "tools", "serve.mjs"), DIR, "--port", String(PORT)],
  { stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 400));

// The destination is served by the same local server, so the measurement is
// of this page's decode-and-go, not of somebody else's site.
const DESTINATION = `${BASE}robots.txt`;
const payload = await shorten(DESTINATION);

/** Median, not mean: one slow run should not move the number. */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

/**
 * One cold load. A fresh context every time, so nothing is cached and no
 * previous run's compiled code is reused.
 */
async function once(url, waitFor) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (NET) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NET });
  }
  await cdp.send("Performance.enable");

  const started = Date.now();
  await page.goto(url, { waitUntil: "commit" });
  await waitFor(page);
  const wall = Date.now() - started;

  const metrics = Object.fromEntries(
    (await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  // A redirect lands on another document, where this one's timings are gone.
  // What survives is the wall clock, which is the number being asked for.
  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      domInteractive: nav?.domInteractive ?? 0,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
      fcp: paint?.startTime ?? 0,
      ready: performance.now(),
    };
  }).catch(() => ({ domInteractive: 0, domContentLoaded: 0, fcp: 0, ready: 0 }));
  await context.close();
  return {
    ...timing,
    ready: timing.ready || wall,
    // Chrome reports these in seconds; everything else here is milliseconds.
    script: (metrics.ScriptDuration ?? 0) * 1000,
    layout: (metrics.LayoutDuration ?? 0) * 1000,
    style: (metrics.RecalcStyleDuration ?? 0) * 1000,
  };
}

/**
 * The redirect path's finish line: the Continue button has a destination.
 * That is the earliest moment the page could send someone onwards, so it is
 * the only latency that matters for a link.
 */
const destinationReady = (page) =>
  page.waitForFunction(() => {
    const go = /** @type {HTMLAnchorElement} */ (document.getElementById("r-go"));
    return go && go.href && !go.href.endsWith("#");
  }, { timeout: 30000 });

const interactive = (page) =>
  page.waitForFunction(() => document.readyState === "complete", { timeout: 30000 });

/**
 * The plain redirect never waits for the DOM: it decodes and calls
 * location.replace(). So the finish line is the *next* navigation committing,
 * which is the honest answer to "how long between the click and arriving".
 */
const arrived = (page) =>
  page.waitForURL(DESTINATION, { timeout: 30000, waitUntil: "commit" });

const scenarios = [
  ["redirect", `${BASE}#${payload}`, arrived],
  ["interstitial", `${BASE}#${payload}~`, destinationReady],
  ["create", BASE, interactive],
];

console.log(`\n${DIR}/ · ${CPU}x CPU throttle · ` +
  `${NET ? `${(NET.downloadThroughput * 8 / 1024 / 1024).toFixed(1)} Mbps / ` +
    `${NET.latency} ms RTT` : "no network throttle"} · median of ${RUNS}\n`);
const report = {};
try {
  for (const [name, url, waitFor] of scenarios) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await once(url, waitFor));
    const of = (key) => median(runs.map((r) => r[key]));
    report[name] = {
      ready: of("ready"),
      fcp: of("fcp"),
      domInteractive: of("domInteractive"),
      script: of("script"),
      styleAndLayout: of("style") + of("layout"),
    };
    console.log(`  ${name}`);
    const what = { redirect: "(arrived at the destination)",
      interstitial: "(destination resolved)", create: "(load complete)" }[name];
    console.log(`    ready            ${of("ready").toFixed(0)} ms   ${what}`);
    console.log(`    first paint      ${of("fcp").toFixed(0)} ms`);
    console.log(`    dom interactive  ${of("domInteractive").toFixed(0)} ms`);
    console.log(`    script           ${of("script").toFixed(0)} ms`);
    console.log(`    style + layout   ${report[name].styleAndLayout.toFixed(0)} ms\n`);
  }
} finally {
  await browser.close();
  server.kill();
}

if (args.includes("--json")) console.log(JSON.stringify(report));
