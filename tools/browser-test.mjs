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
  // A CSP violation surfaces as a console error, but catch it explicitly too:
  // a policy that silently blocks the page's own script would otherwise look
  // like "no console errors" while nothing worked.
  await page.addInitScript(() => {
    addEventListener("securitypolicyviolation", (event) => {
      (window.__cspViolations ??= []).push(
        `${event.violatedDirective} blocked ${event.blockedURI}`);
    });
  });

  // ---- creating a link ----------------------------------------------------
  await page.goto(BASE);
  const LONG = "https://www.theguardian.com/world/2024/jan/15/some-long-article" +
    "-title-here?utm_source=twitter&utm_medium=social";
  await page.fill("#url", LONG);
  await page.waitForSelector("#result:not([hidden])");

  const link = await page.inputValue("#short");
  // Links carry an integrity tag by default, so the fragment is
  // <payload>.c<tag> rather than a bare payload.
  check("a link is generated", /#[A-Za-z0-9_-]+(\.[ch][A-Za-z0-9_-]+)?$/.test(link),
    link.slice(0, 60));
  check("the link is shorter than the input",
    link.length < LONG.length, `${LONG.length} -> ${link.length}`);

  // ---- the breakdown renders ---------------------------------------------
  await page.waitForSelector("#breakdown:not([hidden])");
  const segments = await page.locator("#bits i").count();
  const modeRows = await page.locator(".mode-row").count();
  const winners = await page.locator(".mode-row.won").count();
  check("the bit breakdown renders", segments >= 2, `${segments} segments`);
  check("all four encodings are shown", modeRows === 4, `${modeRows} rows`);
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

  // ---- content security policy -------------------------------------------
  const violations = await page.evaluate(() => window.__cspViolations ?? []);
  check("no Content-Security-Policy violations", violations.length === 0,
    violations.join(" | "));

  const policy = await page.evaluate(() =>
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? "");
  check("a Content-Security-Policy is present", policy.includes("default-src 'none'"));
  if (DIR === "dist") {
    check("the built policy pins scripts by hash",
      /script-src 'sha256-/.test(policy) && !policy.includes("unsafe-inline"),
      policy.slice(0, 70));
  }

  // ---- suspicious destinations are not followed silently ------------------
  for (const [label, target] of [
    ["userinfo", "https://paypal.com@evil.example/login"],
    ["punycode", "https://xn--pypal-4ve.example/"],
    ["ip literal", "https://192.0.2.10/admin"],
  ]) {
    // #result is already visible from the previous case, so waiting on it
    // would read a stale link. Wait for the value itself to change.
    const stale = await page.inputValue("#short").catch(() => "");
    await page.fill("#url", target);
    await page.waitForFunction(
      (previous) => {
        const field = document.getElementById("short");
        return field && field.value && field.value !== previous;
      }, stale, { timeout: 5000 });
    const suspicious = await page.inputValue("#short");

    const victim = await context.newPage();
    await victim.route("**/*", (route) =>
      route.request().url().startsWith(BASE)
        ? route.continue()
        : route.fulfill({ status: 200, body: "SHOULD NOT REACH" }));
    await victim.goto(suspicious);
    await victim.waitForSelector("#r-warnings:not([hidden])", { timeout: 5000 })
      .catch(() => {});
    const stayed = victim.url().startsWith(BASE);
    const warned = await victim.locator("#r-warnings li.warn").count();
    check(`a ${label} destination is not followed silently`, stayed && warned > 0,
      `stayed=${stayed} warnings=${warned}`);
    await victim.close();
  }

  // ---- integrity tag ------------------------------------------------------
  {
    const stale = await page.inputValue("#short").catch(() => "");
    await page.fill("#url", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page.waitForFunction((previous) => {
      const field = document.getElementById("short");
      return field && field.value && field.value !== previous;
    }, stale, { timeout: 5000 });
    const tagged = await page.inputValue("#short");
    check("links carry an integrity tag by default", /#[A-Za-z0-9_-]+\.c[A-Za-z0-9_-]+$/
      .test(tagged), tagged.slice(-28));

    // A template should have made this one small.
    const payload = tagged.split("#")[1].split(".")[0];
    check("a YouTube link uses a template", payload.length <= 18, `${payload.length} chars`);

    const follower = await context.newPage();
    await follower.route("**/*", (route) =>
      route.request().url().startsWith(BASE)
        ? route.continue()
        : route.fulfill({ status: 200, body: "DEST" }));
    await follower.goto(tagged);
    await follower.waitForURL((url) => !url.href.startsWith(BASE), { timeout: 5000 })
      .catch(() => {});
    check("a tagged link still follows to the destination",
      follower.url() === "https://www.youtube.com/watch?v=dQw4w9WgXcQ", follower.url());
    await follower.close();

    // Flip one character of the payload; the tag must catch it.
    const at = tagged.indexOf("#") + 2;
    const swapped = tagged[at] === "A" ? "B" : "A";
    const altered = tagged.slice(0, at) + swapped + tagged.slice(at + 1);
    const victim = await context.newPage();
    await victim.route("**/*", (route) =>
      route.request().url().startsWith(BASE)
        ? route.continue()
        : route.fulfill({ status: 200, body: "SHOULD NOT REACH" }));
    await victim.goto(altered);
    await victim.waitForSelector("#r-title");
    const title = (await victim.textContent("#r-title")).trim();
    check("an altered link is refused, not followed",
      victim.url().startsWith(BASE) && title === "This link has been altered", title);
    await victim.close();
  }

  // ---- signed links -------------------------------------------------------
  {
    // The passphrase field is behind a <details>, which has to be open before
    // Playwright will type into it — same as for a person.
    await page.evaluate(() => { document.querySelector(".advanced").open = true; });
    await page.fill("#passphrase", "team-secret");
    const stale = await page.inputValue("#short");
    await page.fill("#url", "https://example.com/signed/target");
    await page.waitForFunction((previous) => {
      const field = document.getElementById("short");
      return field && field.value && field.value !== previous;
    }, stale, { timeout: 5000 });
    const signed = await page.inputValue("#short");
    check("a passphrase produces a signed link",
      /#[A-Za-z0-9_-]+\.h[A-Za-z0-9_-]{16}$/.test(signed), signed.slice(-24));

    const reader = await context.newPage();
    await reader.route("**/*", (route) =>
      route.request().url().startsWith(BASE)
        ? route.continue()
        : route.fulfill({ status: 200, body: "DEST" }));
    await reader.goto(signed);
    await reader.waitForSelector("#r-passphrase:not([hidden])");
    check("a signed link waits instead of redirecting", reader.url().startsWith(BASE));

    await reader.fill("#r-pass", "wrong");
    await reader.click("#r-check");
    await reader.waitForSelector("#r-passphrase .tag-note");
    check("the wrong passphrase is rejected",
      (await reader.textContent("#r-passphrase .tag-note")).includes("does not match"));

    await reader.fill("#r-pass", "team-secret");
    await reader.click("#r-check");
    await reader.waitForFunction(() =>
      document.querySelector("#r-passphrase .tag-note")?.textContent.includes("verified"));
    check("the right passphrase verifies",
      (await reader.textContent("#r-passphrase .tag-note")).includes("verified"));
    await reader.close();

    await page.fill("#passphrase", "");
  }

  // ---- damaged fragments that are not even decodable ----------------------
  {
    // "#%" throws URIError inside decodeURIComponent; this used to leave the
    // spinner running forever with an unhandled rejection in the console.
    const broken = await context.newPage();
    await broken.goto(BASE + "#%");
    await broken.waitForFunction(() =>
      document.getElementById("r-title")?.textContent.includes("didn't work"),
      { timeout: 5000 });
    const spinnerGone = await broken.locator("#r-spinner").count() === 0;
    check("an undecodable fragment shows the failure card, not a spinner",
      spinnerGone, `spinner remained: ${!spinnerGone}`);
    await broken.close();
  }

  // ---- the template row in the breakdown ----------------------------------
  {
    await page.fill("#url", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
    // Waiting on #short races the previous section's debounced update, so
    // wait for the assertion's own condition: the template row marked won.
    const won = await page.waitForFunction(() =>
      document.querySelector(".mode-row.won .name")?.textContent === "template",
      { timeout: 5000 }).then(() => true).catch(() => false);
    const rows = await page.locator(".mode-row").count();
    check("the breakdown shows the template row as the winner",
      rows === 4 && won, `${rows} rows, template won: ${won}`);
  }

  // ---- works with JavaScript switched off ---------------------------------
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const plain = await noJs.newPage();
  await plain.goto(BASE);
  const readable = await plain.locator("#create").isVisible();
  const explains = (await plain.textContent("body")).includes("JavaScript is off");
  check("the page still reads with JavaScript off", readable && explains,
    `visible=${readable} noscript=${explains}`);
  const noJsOverflow = await plain.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no-JS layout does not overflow", noJsOverflow <= 0, `${noJsOverflow}px`);
  await noJs.close();

  // ---- responsive ---------------------------------------------------------
  await page.fill("#url", "https://example.com/a/reasonably/long/path?with=params");
  await page.waitForSelector("#result:not([hidden])");
  for (const width of [320, 360, 390, 414, 768, 1024]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(60);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal overflow at ${width}px`, overflow <= 0, `${overflow}px`);
  }

  // Touch targets people actually have to hit.
  await page.setViewportSize({ width: 360, height: 780 });
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("#create button, #create .btn, #create input")]
      // A checkbox is 18px but sits inside a label that toggles it, so the
      // thing being tapped is the label. Measure what the finger actually hits.
      .map((el) => (el.closest("label") ?? el))
      .map((el) => ({ el: el.id || el.className, h: el.getBoundingClientRect().height }))
      .filter((item) => item.h > 0 && item.h < 32));
  check("touch targets are big enough on mobile", small.length === 0,
    small.map((s) => `${s.el}:${Math.round(s.h)}px`).join(" "));

  await page.screenshot({ path: path.join(ROOT, "dist", "_screenshot-mobile.png") })
    .catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
