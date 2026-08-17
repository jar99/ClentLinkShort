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
import { createHash } from "node:crypto";
import path from "node:path";

import { minifyJS, minifyCSS, minifyHTML } from "./minify.js";
import { bundle } from "./bundle.js";
import { HOSTS } from "../src/hosts.js";
import { TEMPLATES } from "../src/templates.js";

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
    siteUrl: (stats.origin ?? "").replace(/#$/, ""),
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
    hostCount: String(HOSTS.length),
    templates: String(TEMPLATES.length),
    // The shortest prefix the validator measured, so the page cannot quote a
    // figure for a domain length nobody checked.
    shortBreakEven: String(
      (stats.prefixes ?? []).filter((p) => p.length > 0 && p.breakEven)
        .sort((a, b) => a.length - b.length)[0]?.breakEven ?? "—"),
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
 * Content-Security-Policy
 * -------------------------------------------------------------------------- */

const sha256 = (text) =>
  "'sha256-" + createHash("sha256").update(text, "utf8").digest("base64") + "'";

/**
 * Replace the permissive dev policy with one that names the exact scripts and
 * styles this page is allowed to run, by hash.
 *
 * The built page is entirely self-contained, so everything except its own
 * inline code can be forbidden outright: no network of any kind, no plugins,
 * no form submissions, no base tag rewriting. If an injected script ever did
 * make it into the document, it would have the wrong hash and not run.
 *
 * frame-ancestors is absent because a meta tag cannot set it — browsers ignore
 * it there and log an error — and GitHub Pages cannot send headers. That is a
 * real gap, and the README says so rather than pretending otherwise.
 */
function applyStrictCsp(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1]);
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]);

  if (!scripts.length) throw new Error("no inline scripts found to hash");

  const policy = [
    "default-src 'none'",
    `script-src ${scripts.map(sha256).join(" ")}`,
    `style-src ${styles.map(sha256).join(" ") || "'none'"}`,
    // 'self' beside data: lets the manifest reference icon.svg; the worker
    // and manifest sources are the service worker and web app manifest —
    // both same-origin files this build writes.
    "img-src data: 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    // The service worker's background refresh runs in worker scope, not
    // under this document policy, so connect-src stays closed.
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    // frame-ancestors is deliberately absent: it is ignored in a meta tag and
    // browsers log an error for it on every load. Clickjacking protection
    // needs a real header, which GitHub Pages cannot send. Noted in the README.
  ].join("; ");

  const replaced = html.replace(
    /<meta http-equiv="Content-Security-Policy"[^>]*>/i,
    () => `<meta http-equiv="Content-Security-Policy" content="${policy}">`);

  if (replaced === html) throw new Error("no Content-Security-Policy meta tag to replace");
  return replaced;
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

  const stats = await readCorpusStats();
  const htmlSource = substituteStats(
    await readFile(path.join(SRC, "index.html"), "utf8"), stats);

  // The canonical site address comes from the measured origin — the one
  // place it is already written down — with the fragment marker dropped.
  const siteUrl = new URL((stats.origin ?? "https://example.invalid/#")
    .replace(/#$/, ""));
  const cssSource = await readFile(path.join(SRC, "style.css"), "utf8");
  const { code, files } = await bundle(path.join(SRC, "app.js"));

  const before = [
    sizes("html", htmlSource),
    sizes("css", cssSource),
    sizes("js", code),
  ];

  const css = minifyCSS(cssSource);
  const js = minifyJS(code);

  // The bundle has no imports left, so it can ship as a classic script rather
  // than a module. That matters: module scripts are always deferred, and this
  // one sits in <head> precisely so a redirect can fire before the body is
  // parsed. Wrapped in an IIFE because classic scripts share global scope.
  const inlineJs = `(()=>{"use strict";\n${js}\n})();`;

  // Fold everything into the document, replacing the dev-mode references.
  //
  // The replacements are functions, not strings, and that is load-bearing: a
  // string replacement expands "$&", "$1" and friends, and the bundled code
  // contains the standard regex-escaping idiom `replace(/../g, "\\$&")`. As a
  // string, that "$&" would be substituted with the matched <script> tag and
  // quietly corrupt the built page. A function replacement disables all of it.
  let html = htmlSource
    .replace(/[ \t]*<link rel="stylesheet"[^>]*>\n?/, () => `<style>${css}</style>`)
    .replace(/[ \t]*<script type="module" src="[^"]*"><\/script>\n?/,
      () => `<script>${inlineJs}</script>`);

  if (/<link[^>]+rel="stylesheet"/.test(html) || /<script[^>]+src=/.test(html)) {
    throw new Error("index.html no longer matches the inlining patterns in build.mjs");
  }

  html = applyStrictCsp(html);

  html = minifyHTML(html);
  await writeFile(path.join(DIST, "index.html"), html);
  await writeFile(path.join(DIST, ".nojekyll"), "");
  await writeFile(path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${siteUrl.href}sitemap.xml\n`);
  await writeFile(path.join(DIST, "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `  <url><loc>${siteUrl.href}</loc></url>\n` +
    "</urlset>\n");

  // A custom domain needs a CNAME file in the artifact; a github.io origin
  // must not have one, so forks that revert the origin lose it automatically.
  if (!siteUrl.host.endsWith(".github.io")) {
    await writeFile(path.join(DIST, "CNAME"), siteUrl.host + "\n");
  }

  // GitHub Pages serves 404.html for unknown paths. Serving the app there too
  // means a mistyped path still resolves the fragment instead of dead-ending.
  await writeFile(path.join(DIST, "404.html"), html);

  // The offline pieces: manifest, icon, and the service worker stamped with
  // this build's content hash so a deploy rotates the cache.
  const buildHash = createHash("sha256").update(html).digest("hex").slice(0, 12);
  const swSource = await readFile(path.join(SRC, "sw.js"), "utf8");
  await writeFile(path.join(DIST, "sw.js"),
    minifyJS(swSource.replace(/\{\{cacheVersion\}\}/g, () => buildHash)));
  await writeFile(path.join(DIST, "manifest.webmanifest"),
    await readFile(path.join(SRC, "manifest.webmanifest"), "utf8"));
  await writeFile(path.join(DIST, "icon.svg"),
    await readFile(path.join(SRC, "icon.svg"), "utf8"));

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
