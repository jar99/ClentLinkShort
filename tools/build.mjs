#!/usr/bin/env node
/**
 * Build the site into a single self-contained file.
 *
 * The page is a redirector: the time between a click and the browser knowing
 * where to go is the entire user experience. Every separate request is a round
 * trip added to that, so the build inlines the module graph, the stylesheet and
 * the icon into one HTML file. A visitor makes exactly one request, and the
 * redirect fires as soon as it lands.
 *
 * The bundler is intentionally tiny and only understands this project's own
 * imports: static, relative, side-effect-free ES modules with no cycles.
 * Anything outside that is a build error rather than a silent mistake.
 */

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import path from "node:path";

import { minifyJS, minifyCSS, minifyHTML } from "./minify.js";
import { bundle } from "./bundle.js";

import { ROOT } from "./bundle.js";
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

/* -------------------------------------------------------------------------- *
 * Measured claims
 * -------------------------------------------------------------------------- */

/**
 * The page states specific numbers about how well the codec does on real URLs.
 * They are substituted at build time from the last validation run rather than
 * typed into the markup, so the page cannot drift into quoting figures that
 * were true of an older codec.
 */
async function readCorpusStats() {
  const file = path.join(ROOT, "corpus", "stats.json");
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      "corpus/stats.json is missing — the page quotes measured numbers.\n" +
      "  Run: npm run validate");
  }
}

function substituteStats(html, stats) {
  const values = {
    checked: stats.checked.toLocaleString("en-US"),
    roundTrip: stats.failures === 0 ? "100%" : `${(100 * stats.checked /
      (stats.checked + stats.failures)).toFixed(2)}%`,
    shorterPct: `${stats.payloadShorterPct.toFixed(1)}%`,
    medianPct: `${(100 * stats.medianRatio).toFixed(0)}%`,
    overallPct: `${(100 * stats.payloadRatio).toFixed(0)}%`,
    deepShorter: `${stats.deepShorterPct.toFixed(0)}%`,
    deepSaving: `${(100 * stats.deepSavingsMedian).toFixed(0)}%`,
    breakEven: stats.breakEvenLength ? String(stats.breakEvenLength) : "—",
    originLength: String((stats.origin ?? "").length),
    linkShorter: `${stats.linkShorterPct.toFixed(1)}%`,
    generated: stats.generated ?? "",
  };

  const out = html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in values)) throw new Error(`index.html uses unknown placeholder ${match}`);
    return values[key];
  });

  const missed = out.match(/\{\{\w+\}\}/);
  if (missed) throw new Error(`unsubstituted placeholder ${missed[0]}`);
  return out;
}

/* -------------------------------------------------------------------------- *
 * Build
 * -------------------------------------------------------------------------- */

const sizes = (label, text) => {
  const raw = Buffer.byteLength(text);
  const gz = gzipSync(text, { level: 9 }).length;
  const br = brotliCompressSync(Buffer.from(text), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;
  return { label, raw, gz, br };
};

const kb = (n) => (n / 1024).toFixed(1).padStart(6) + " kB";

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const htmlSource = substituteStats(
    await readFile(path.join(SRC, "index.html"), "utf8"),
    await readCorpusStats());
  const cssSource = await readFile(path.join(SRC, "style.css"), "utf8");
  const { code, files } = await bundle(path.join(SRC, "app.js"));

  const before = [
    sizes("html", htmlSource),
    sizes("css", cssSource),
    sizes("js", code),
  ];

  const css = minifyCSS(cssSource);
  const js = minifyJS(code);

  // Fold everything into the document, replacing the dev-mode references.
  let html = htmlSource
    .replace(/[ \t]*<link rel="stylesheet"[^>]*>\n?/,
      `<style>${css}</style>`)
    .replace(/[ \t]*<script type="module" src="[^"]*"><\/script>\n?/,
      `<script type="module">${js}</script>`);

  if (html.includes("stylesheet") || html.includes('src="./app.js"')) {
    throw new Error("index.html no longer matches the inlining patterns in build.mjs");
  }

  html = minifyHTML(html);
  await writeFile(path.join(DIST, "index.html"), html);
  await writeFile(path.join(DIST, ".nojekyll"), "");

  // GitHub Pages serves 404.html for unknown paths. Serving the app there too
  // means a mistyped path still resolves the fragment instead of dead-ending.
  await writeFile(path.join(DIST, "404.html"), html);

  const after = sizes("index.html", html);
  const beforeTotal = before.reduce((sum, s) => sum + s.raw, 0);

  console.log("Source");
  for (const s of before) console.log(`  ${s.label.padEnd(12)} ${kb(s.raw)}`);
  console.log(`  ${"total".padEnd(12)} ${kb(beforeTotal)}   in ${files.length + 2} files`);
  console.log("\nBuilt  dist/index.html");
  console.log(`  ${"raw".padEnd(12)} ${kb(after.raw)}   ` +
    `${(100 * after.raw / beforeTotal).toFixed(0)}% of source`);
  console.log(`  ${"gzip".padEnd(12)} ${kb(after.gz)}`);
  console.log(`  ${"brotli".padEnd(12)} ${kb(after.br)}`);
  console.log(`\n  1 request, ${after.br} bytes over the wire with brotli.`);
}

main().catch((error) => {
  console.error(`\nBuild failed: ${error.message}`);
  process.exit(1);
});
