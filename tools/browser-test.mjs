#!/usr/bin/env node
/**
 * End-to-end browser tests.
 *
 * Everything else in this repo runs without dependencies. This does not: it
 * needs Playwright, so it is kept out of `npm test` and run on demand.
 *
 *   npx playwright install chromium
 *   node tools/browser-test.mjs dist      # the built, minified site
 *   node tools/browser-test.mjs src       # the unbuilt sources
 *
 * `dist` is the one that matters. The Node tests prove the minified codec is
 * equivalent to the source; this proves the minified *page* still works —
 * that the inlining, the pre-paint view switch and the redirect all survive.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = process.argv[2] ?? "dist";
const PORT = 8781;
const BASE = `http://localhost:${PORT}/`;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && " +
    "npx playwright install chromium");
  process.exit(2);
}

const server = spawn(process.execPath,
  [path.join(ROOT, "tools", "serve.mjs"), DIR, "--port", String(PORT)],
  { stdio: "ignore" });
await new Promise((resolve) => setTimeout(resolve, 400));

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const context = await browser.newContext();
const consoleErrors = [];

try {
  console.log(`\nTesting ${DIR}/ at ${BASE}\n`);
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(`console: ${message.text()}`);
  });

  // ---- creating a link ----------------------------------------------------
  await page.goto(BASE);
  const LONG = "https://www.theguardian.com/world/2024/jan/15/some-long-article" +
    "-title-here?utm_source=twitter&utm_medium=social";
  await page.fill("#url", LONG);
  await page.waitForSelector("#result:not([hidden])");

  const link = await page.inputValue("#short");
  check("a link is generated", /#[A-Za-z0-9_-]+$/.test(link), link.slice(0, 60));
  check("the link is shorter than the input",
    link.length < LONG.length, `${LONG.length} -> ${link.length}`);

  // ---- the breakdown renders ---------------------------------------------
  await page.waitForSelector("#breakdown:not([hidden])");
  const segments = await page.locator("#bits i").count();
  const modeRows = await page.locator(".mode-row").count();
  const winners = await page.locator(".mode-row.won").count();
  check("the bit breakdown renders", segments >= 2, `${segments} segments`);
  check("all three body modes are shown", modeRows === 3, `${modeRows} rows`);
  check("exactly one mode is marked as the winner", winners === 1, `${winners} marked`);

  // ---- following a link ---------------------------------------------------
  const follower = await context.newPage();
  await follower.route("**/*", (route) =>
    route.request().url().startsWith(BASE)
      ? route.continue()
      : route.fulfill({ status: 200, body: "DESTINATION" }));
  await follower.goto(link);
  await follower.waitForURL((url) => !url.href.startsWith(BASE), { timeout: 5000 });
  check("following the link reaches the destination",
    follower.url() === "https://www.theguardian.com/world/2024/jan/15/" +
      "some-long-article-title-here",
    follower.url());
  await follower.close();

  // ---- preview mode -------------------------------------------------------
  const preview = await context.newPage();
  await preview.goto(link + "~");
  await preview.waitForSelector("#r-dest");
  const shown = (await preview.textContent("#r-dest")).trim();
  check("preview mode shows the destination without following it",
    preview.url().startsWith(BASE) && shown.includes("theguardian.com"), shown.slice(0, 50));
  await preview.close();

  // ---- hostile fragments --------------------------------------------------
  for (const [fragment, label] of [
    ["____________", "unknown format"],
    ["AAAA", "truncated"],
    ["!!!!", "invalid characters"],
  ]) {
    const hostile = await context.newPage();
    let dialogFired = false;
    hostile.on("dialog", async (dialog) => { dialogFired = true; await dialog.dismiss(); });
    await hostile.goto(BASE + "#" + fragment);
    await hostile.waitForSelector("#r-title");
    const title = (await hostile.textContent("#r-title")).trim();
    check(`a hostile fragment fails safely (${label})`,
      !dialogFired && hostile.url().startsWith(BASE) && title === "This link didn't work",
      title);
    await hostile.close();
  }

  // ---- the creator UI never flashes on a redirect --------------------------
  const flash = await context.newPage();
  await flash.route("**/*", (route) =>
    route.request().url().startsWith(BASE)
      ? route.continue()
      : route.fulfill({ status: 200, body: "DESTINATION" }));
  const heroVisible = [];
  await flash.goto(BASE + "#" + link.split("#")[1], { waitUntil: "commit" });
  for (let i = 0; i < 5; i++) {
    heroVisible.push(await flash.locator("#create").isVisible().catch(() => false));
    await flash.waitForTimeout(20);
  }
  check("the creator UI never appears during a redirect",
    !heroVisible.some(Boolean), `${heroVisible.filter(Boolean).length} frames visible`);
  await flash.close();

  // ---- input validation ---------------------------------------------------
  await page.fill("#url", "javascript:alert(1)");
  await page.waitForSelector("#error:not([hidden])");
  check("dangerous schemes are refused",
    (await page.textContent("#error")).includes("Refusing"));

  await page.fill("#url", "");
  await page.waitForTimeout(200);
  check("clearing the field clears the result", await page.locator("#result").isHidden());

  // ---- copy ---------------------------------------------------------------
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.fill("#url", "https://example.com/hello");
  await page.waitForSelector("#result:not([hidden])");
  await page.click("#copy");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check("the copy button copies the link", clip === await page.inputValue("#short"));

  // ---- the privacy claims -------------------------------------------------
  const stored = await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
  }));
  check("nothing is stored in the browser",
    stored.local === 0 && stored.session === 0 && stored.cookie === "",
    JSON.stringify(stored));

  const requests = [];
  const counter = await context.newPage();
  counter.on("request", (r) => requests.push(r.url()));
  await counter.goto(BASE, { waitUntil: "networkidle" });
  const external = requests.filter((url) => !url.startsWith(BASE) && !url.startsWith("data:"));
  check("the page makes no external requests", external.length === 0, external.join(", "));
  if (DIR === "dist") {
    check("the built page is a single request", requests.length === 1,
      `${requests.length} requests: ${requests.map((u) => u.replace(BASE, "/")).join(" ")}`);
  }
  await counter.close();

  check("no console errors", consoleErrors.length === 0, consoleErrors.join(" | "));

  // ---- responsive ---------------------------------------------------------
  await page.setViewportSize({ width: 360, height: 720 });
  await page.fill("#url", "https://example.com/a/reasonably/long/path?with=params");
  await page.waitForSelector("#result:not([hidden])");
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal overflow at 360px", overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: path.join(ROOT, "dist", "_screenshot-mobile.png") })
    .catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
