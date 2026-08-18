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
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { shorten } from "../src/clent.js";
import { ports } from "../clent.config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = process.argv[2] ?? "dist";
const PORT = Number(process.env.PORT || ports.test);
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

  // A fresh visit must start pristine. The regression here was real: the
  // DOMContentLoaded *event object* leaked into setUpCreate's prefill
  // parameter, and every first-time visitor saw "[object Event]" in the box
  // with an error underneath. Only the built page hits the listener path
  // (its script runs in <head>), which is why dev mode never showed it.
  await page.waitForTimeout(300);
  const pristine = await page.inputValue("#url");
  const errorShown = await page.locator("#error:not([hidden])").count();
  check("a fresh visit starts with an empty box and no error",
    pristine === "" && errorShown === 0, `value=${JSON.stringify(pristine)}`);
  // The provenance line: a shortener that asks to be trusted with where you
  // are going should say who wrote it somewhere a person can see, not only in
  // structured data. It is also the "who" of Google's who/how/why test.
  const source = page.locator("footer a[href*='github.com']");
  check("the footer says where the source is",
    await source.count() === 1 &&
    (await source.getAttribute("href")) === "https://github.com/jar99/ClentLinkShort",
    await source.getAttribute("href") ?? "absent");
  // Hidden markup is what a crawler and the accessibility tree skip, so the
  // first heading either meets must be the page's own — not the frame-refusal
  // notice, which sits above it in the document.
  const firstHeading = await page.evaluate(() =>
    [...document.querySelectorAll("h1")]
      // checkVisibility walks ancestors: a heading inside a hidden <aside> is
      // itself display:block, which is how a naive test passes on a page a
      // crawler would read quite differently.
      .find((h) => h.checkVisibility())
      ?.textContent?.trim());
  check("the first visible heading is the page's own",
    firstHeading === "The link shortener that stores\u00a0nothing.", firstHeading);

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
  check("all five encodings are shown", modeRows === 5, `${modeRows} rows`);
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

  // Counted on the CONTEXT, not the page: a page-level listener cannot see
  // service-worker traffic (its own script, and everything it precaches), so
  // it reports one request no matter how many the visit actually makes. The
  // claim in the README is only worth anything if the thing measuring it can
  // observe a failure.
  const requests = [];
  const fresh = await browser.newContext();
  fresh.on("request", (r) => requests.push(r.url()));
  const counter = await fresh.newPage();
  await counter.goto(BASE, { waitUntil: "networkidle" });
  // The worker registers after load and precaches on its own clock.
  await counter.waitForTimeout(1500);
  const external = requests.filter((url) => !url.startsWith(BASE) && !url.startsWith("data:"));
  check("the page makes no external requests", external.length === 0, external.join(", "));
  check("every request is same-origin and none carries a fragment",
    requests.every((url) => url.startsWith(BASE) && !url.includes("#")),
    requests.join(" "));
  if (DIR === "dist") {
    // One request on the critical path — the document — and the rest are the
    // worker and what it precaches, none of which block a redirect.
    check("the built page needs one request to decode a link",
      requests.filter((u) => u === BASE).length >= 1 && requests.length <= 8,
      `${requests.length} requests: ${requests.map((u) => u.replace(BASE, "/")).join(" ")}`);
  }

  // Cache Storage is the one thing the page does write. It holds the app, and
  // it provably cannot hold a destination: fragments are excluded from a
  // Request URL, so no cache key can carry one. Asserted rather than argued.
  const cached = await counter.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return { names, urls };
  });
  check("no cached entry carries a link payload",
    cached.urls.every((url) => url.startsWith(BASE) && !url.includes("#")),
    cached.urls.join(" "));
  await counter.close();
  await fresh.close();

  // ---- the page refuses to be framed --------------------------------------
  // frame-ancestors only works as a header, which a static host may not be
  // able to send, so the page declines on its own. Without this a redirector
  // is the perfect clickjacking target: frame it, go transparent, and float
  // the victim's click onto "Continue".
  {
    const framed = await context.newPage();
    await framed.setContent(
      `<iframe src="${BASE}#B2wjKA2W" width="600" height="400"></iframe>`);
    await framed.waitForTimeout(1200);
    const inner = framed.frames().find((f) => f.url().startsWith(BASE));
    const state = inner
      ? await inner.evaluate(() => ({
          framed: document.documentElement.dataset.framed === "1",
          destination: document.getElementById("r-dest")?.textContent ?? "",
          go: document.getElementById("r-go")?.getAttribute("href") ?? "",
          // The notice ships hidden so crawlers and the accessibility tree
          // skip it; a real frame is the one thing that must reveal it.
          noticeShown: (() => {
            const notice = document.getElementById("framed");
            return !!notice && !notice.hidden &&
              getComputedStyle(notice).display !== "none";
          })(),
        }))
      : null;
    check("a framed page marks itself framed", state?.framed === true, JSON.stringify(state));
    check("the refusal notice is shown inside a frame, and only there",
      state?.noticeShown === true);
    check("a framed page decodes nothing and offers no destination to click",
      state !== null && state.destination === "" && state.go === "",
      JSON.stringify(state));
    await framed.close();
  }

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

    // Strip the tag down to nothing: "#payload.c". An empty tag must fail —
    // verify() recomputing at length 0 used to compare "" to "" and pass.
    const bare = tagged.slice(0, tagged.lastIndexOf(".") + 2);
    const clipped = await context.newPage();
    await clipped.route("**/*", (route) =>
      route.request().url().startsWith(BASE)
        ? route.continue()
        : route.fulfill({ status: 200, body: "SHOULD NOT REACH" }));
    await clipped.goto(bare);
    await clipped.waitForSelector("#r-title");
    const clippedTitle = (await clipped.textContent("#r-title")).trim();
    check("an empty integrity tag fails, never quietly passes",
      clipped.url().startsWith(BASE) && clippedTitle === "This link has been altered",
      clippedTitle);
    await clipped.close();
  }

  // ---- link styles: dense and emoji ---------------------------------------
  {
    const wait = async (previous) => {
      await page.waitForFunction((old) => {
        const field = document.getElementById("short");
        return field && field.value && field.value !== old;
      }, previous, { timeout: 5000 });
      return page.inputValue("#short");
    };
    // Long enough that the dense dress must strictly win: the ~ marker costs
    // one character, the 87-symbol alphabet earns it back about every 15.
    const target = "https://internal.example-corp.io/teams/platform/runbooks/" +
      "incident-response-checklist-2026?revision=41";
    const stale = await page.inputValue("#short").catch(() => "");
    await page.fill("#url", target);
    const plain = await wait(stale);

    await page.selectOption("#style", "dense");
    const dense = await wait(plain);
    check("the dense style re-dresses the payload in the wide alphabet",
      /[!$&'()*+,;=:@?#[\]{}|^\\]/.test(dense.split("#")[1] ?? ""), dense.slice(-30));
    check("the dense link is shorter than the standard one",
      dense.length < plain.length, `${dense.length} vs ${plain.length}`);

    const follower = await context.newPage();
    await follower.route("**/*", (route) =>
      route.request().url().startsWith(BASE)
        ? route.continue()
        : route.fulfill({ status: 200, body: "DEST" }));
    await follower.goto(dense);
    await follower.waitForURL((url) => !url.href.startsWith(BASE), { timeout: 5000 })
      .catch(() => {});
    check("a dense link follows to the destination",
      follower.url() === target, follower.url());
    await follower.close();

    await page.selectOption("#style", "emoji");
    const emoji = await wait(dense);
    check("the emoji style produces an emoji payload",
      /#\u{1F400}|#[\u{1F400}-\u{1F4FF}]/u.test(emoji), emoji.slice(-30));

    await page.selectOption("#style", "plain");
    await wait(emoji);
  }

  // ---- maker-side honesty notes ------------------------------------------
  {
    await page.evaluate(() => { document.querySelector(".advanced").open = true; });
    await page.fill("#passphrase", "");
    await page.fill("#url", "https://192.168.1.50/admin");
    await page.waitForSelector(".maker-note", { timeout: 5000 }).catch(() => {});
    const note = await page.textContent(".maker-note").catch(() => "");
    check("making a risky link says the recipient will see a warning first",
      /warning first/.test(note ?? ""), (note ?? "none").slice(0, 60));

    await page.fill("#url", "https://example.com/ok");
    await page.waitForFunction(() => !document.querySelector(".maker-note"),
      { timeout: 5000 }).catch(() => {});
    check("the note clears for an ordinary link",
      await page.locator(".maker-note").count() === 0);
  }

  // ---- bookmarklet prefill ------------------------------------------------
  {
    const target = "https://example.com/from/the/bookmarklet";
    const filled = await context.newPage();
    await filled.goto(BASE + "#s=" + encodeURIComponent(target));
    await filled.waitForFunction(() =>
      document.documentElement.dataset.mode !== "redirect" &&
      /** @type {HTMLTextAreaElement} */(document.getElementById("url"))?.value,
      { timeout: 5000 }).catch(() => {});
    const url = await filled.inputValue("#url").catch(() => "");
    const short = await filled.inputValue("#short").catch(() => "");
    check("a #s= fragment opens the maker prefilled",
      url === target && short.includes("#"), `url=${url.slice(0, 40)}`);
    check("the prefill fragment is cleared from the address bar",
      !filled.url().includes("#s="), filled.url());
    const mark = await filled.getAttribute("#bookmarklet", "href");
    check("the bookmarklet points back at this origin",
      (mark ?? "").startsWith("javascript:") && (mark ?? "").includes("#s="),
      (mark ?? "none").slice(0, 60));
    await filled.close();
  }

  // ---- QR code ------------------------------------------------------------
  {
    await page.fill("#url", "https://example.com/qr/target");
    await page.waitForFunction(() =>
      /** @type {HTMLInputElement} */(document.getElementById("short"))?.value,
      { timeout: 5000 });
    await page.click("#qr");
    await page.waitForSelector("#qr-box svg", { timeout: 5000 }).catch(() => {});
    const modules = await page.evaluate(() => {
      const svg = document.querySelector("#qr-box svg");
      if (!svg) return null;
      const [, , w] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
      return { size: w, path: svg.querySelector("path")?.getAttribute("d")?.length ?? 0 };
    });
    check("the QR button renders a code for the link",
      !!modules && modules.size >= 21 && modules.path > 500,
      JSON.stringify(modules));
    await page.click("#qr");
    check("the QR toggles back off",
      await page.locator("#qr-box svg").count() === 0);
  }

  // ---- the interstitial renders before the document ends -----------------
  // dist-only, and not an oversight: in dev the app is a real module script,
  // which the spec defers until the document is parsed. Only the built page
  // inlines it as a classic script that runs during head parsing, so only the
  // built page can render anything before the document ends.
  if (DIR === "dist") {
    // The redirect card is the first thing in <body>; the maker, the explainer
    // and the FAQ under it are most of the file and nobody opening a link
    // reads them. So the destination must become clickable while the parser is
    // still working, not at DOMContentLoaded. Measured as an ordering rather
    // than a duration, because a threshold would just encode this machine.
    // A fresh context, not the shared one: by now the shared context has an
    // active service worker, and a page it serves does not go through the
    // network stack the throttling below applies to. The measurement would
    // silently be of a cache hit.
    const cold = await browser.newContext();
    const early = await cold.newPage();
    // Localhost hands over the whole document in one piece, so the parser
    // never yields and there is no "before the end" to be earlier than. A slow
    // link is the condition this exists for, so the check runs under one.
    const cdp = await cold.newCDPSession(early);
    await cdp.send("Network.enable");
    // Deliberately slower than the profile the numbers are quoted at. The
    // claim being checked is an ordering, not a duration, and a slow link
    // stretches the stream until the ordering is unmistakable instead of a
    // millisecond apart on whatever machine happens to run this.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
      latency: 400,
    });
    await early.addInitScript(() => {
      new MutationObserver((records, observer) => {
        const go = /** @type {HTMLAnchorElement} */ (document.getElementById("r-go"));
        if (!go || !go.href || go.href.endsWith("#")) return;
        window.__destinationAt = performance.now();
        window.__stateAt = document.readyState;
        observer.disconnect();
      }).observe(document, { childList: true, subtree: true, attributes: true });
    });
    const preview = await shorten("https://example.com/a/path/that/is/plausible");
    await early.goto(`${BASE}#${preview}~`, { waitUntil: "load" });
    const when = await early.evaluate(() => ({
      destination: window.__destinationAt ?? Infinity,
      state: window.__stateAt,
      dcl: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd,
    }));
    check("the destination is ready before the document finishes parsing",
      when.state === "loading" && when.destination < when.dcl,
      `destination at ${when.destination.toFixed(0)}ms (readyState ${when.state}), ` +
      `DOMContentLoaded at ${when.dcl.toFixed(0)}ms`);
    // The card must also be visible by then, or rendering early buys nothing.
    check("the redirect card is shown without waiting for the whole document",
      await early.locator("#redirect").isVisible() &&
      await early.locator("#create").isHidden());
    await cold.close();
  }

  // ---- language -----------------------------------------------------------
  {
    // The picker only exists when there is more than one catalogue, so this
    // block also tells you whether a translation actually shipped.
    const options = await page.$$eval("#lang option",
      (list) => list.map((o) => o.value));
    check("the language picker offers every bundled catalogue",
      options.length >= 2, options.join(","));
    check("the picker is visible once there is a choice",
      await page.locator("#lang-pick").isVisible());

    if (options.includes("es")) {
      await page.selectOption("#lang", "es");
      const after = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        paste: document.querySelector('[data-t="m.pasteLabel"]')?.textContent,
        copy: document.getElementById("copy")?.textContent,
        note: document.getElementById("style-note")?.textContent,
      }));
      check("choosing a language relabels the page and says so in <html lang>",
        after.lang === "es" && after.paste === "Pega una URL larga",
        JSON.stringify(after));
      check("text the app writes by hand is retranslated too",
        after.copy === "Copiar" &&
        after.note === "Base64url; sobrevive a cualquier aplicación y portapapeles",
        `copy=${after.copy} note=${after.note}`);
      check("a left-to-right language keeps dir=ltr", after.dir === "ltr", after.dir);

      // The catalogues cover the controls, not the explainer. With the
      // interface in Spanish, <html lang> says "es", so any prose still in
      // English has to say so itself or it is mislabelled for a screen reader
      // and for every translation engine that reads the page. This is the
      // check that catches new prose arriving without its lang.
      const mislabelled = await page.evaluate(() => {
        const blocks = "#create p, #create li, #create dt, #create dd, " +
          "#create h1, #create h2, #create h3, #create figcaption";
        return [...document.querySelectorAll(blocks)]
          .filter((el) => el.checkVisibility())
          // Elements the catalogue owns are translated by definition, as are
          // the ones the app fills with decoded values rather than prose.
          .filter((el) => !el.closest("[data-t]") && !el.querySelector("[data-t]"))
          .filter((el) => !el.closest("[data-t-dynamic]"))
          .filter((el) => (el.textContent ?? "").trim().length > 40)
          .filter((el) => el.closest("[lang]")?.getAttribute("lang") !== "en")
          .map((el) => (el.textContent ?? "").trim().slice(0, 48));
      });
      check("untranslated prose declares its own language",
        mislabelled.length === 0, mislabelled.join(" | "));

      // The verdict is the maker's actual answer. It used to be built from
      // English fragments in app.js, so a Spanish page reported its result in
      // English — the one line someone was reading for.
      // A verdict is already on screen from an earlier block, so wait for this
      // one to replace it rather than for "some text", which is true already.
      const staleVerdict = await page.textContent("#verdict");
      await page.fill("#url",
        "https://www.theguardian.com/world/2026/aug/18/a-long-article-title" +
        "?utm_source=twitter&utm_medium=social");
      await page.waitForFunction((stale) =>
        (document.getElementById("verdict")?.textContent ?? "") !== stale,
        staleVerdict, { timeout: 5000 });
      const verdict = await page.textContent("#verdict");
      check("the maker's verdict is translated, not just its labels",
        /caracteres más cort|misma longitud|caracteres más largo/.test(verdict ?? ""),
        verdict ?? "");

      await page.selectOption("#lang", "en");
    }

    // The browser's own preference list decides the language with no picker
    // involved — that is the path almost everyone actually takes.
    const spanish = await browser.newContext({ locale: "es-MX" });
    const spanishPage = await spanish.newPage();
    await spanishPage.goto(BASE);
    await spanishPage.waitForTimeout(200);
    const auto = await spanishPage.evaluate(() => ({
      lang: document.documentElement.lang,
      go: document.getElementById("r-go")?.textContent,
    }));
    check("a Spanish browser gets a Spanish page without touching anything",
      auto.lang === "es" && auto.go === "Continuar", JSON.stringify(auto));

    // A language nothing is translated into must land on English, not on a
    // page of raw keys.
    const finnish = await browser.newContext({ locale: "fi-FI" });
    const finnishPage = await finnish.newPage();
    await finnishPage.goto(BASE);
    await finnishPage.waitForTimeout(200);
    const fallback = await finnishPage.evaluate(() => ({
      lang: document.documentElement.lang,
      paste: document.querySelector('[data-t="m.pasteLabel"]')?.textContent,
    }));
    check("an untranslated language falls back to English, not to keys",
      fallback.lang === "en" && fallback.paste === "Paste a long URL",
      JSON.stringify(fallback));
    await spanish.close();
    await finnish.close();

    // No right-to-left catalogue ships yet, so force the direction the way one
    // would and check the layout survives it. This is the difference between
    // "dir is set" and "RTL works": a stray physical margin shows up here as
    // overflow, which the stylesheet test cannot see.
    await page.evaluate(() => { document.documentElement.dir = "rtl"; });
    await page.waitForTimeout(80);
    const rtl = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      // The bullet markers are absolutely positioned; in RTL they must sit on
      // the right of their text, not on top of it.
      marker: (() => {
        const li = document.querySelector(".limits li");
        if (!li) return null;
        const before = getComputedStyle(li, "::before");
        return { insetStart: before.insetInlineStart, padStart:
          getComputedStyle(li).paddingInlineStart };
      })(),
    }));
    check("the layout holds when the document direction is flipped",
      rtl.overflow <= 0, `${rtl.overflow}px overflow`);
    check("direction-dependent spacing is logical, not physical",
      rtl.marker?.padStart === "22px", JSON.stringify(rtl.marker));
    await page.evaluate(() => { document.documentElement.dir = "ltr"; });
  }

  // ---- offline: the service worker keeps the page working -----------------
  // Only the built site ships sw.js, so this block is dist-only.
  if (DIR === "dist") {
    const offlinePage = await context.newPage();
    await offlinePage.goto(BASE);
    const registered = await offlinePage.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "unsupported";
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      return registration ? "active" : "timeout";
    });
    check("the service worker installs", registered === "active", registered);

    if (registered === "active") {
      await context.setOffline(true);
      const airplane = await context.newPage();
      let served = false;
      try {
        await airplane.goto(BASE, { timeout: 8000 });
        await airplane.waitForSelector("#url", { timeout: 5000 });
        served = true;
      } catch { /* recorded below */ }
      check("the page loads with the network gone", served);
      if (served) {
        // And a link still decodes offline: the whole point of carrying the
        // destination inside the fragment.
        const preview = await context.newPage();
        // A payload made by the library right now, so the check can never
        // drift out of step with the shipped tables.
        const payload = await shorten("https://example.com/offline/works");
        let dest = "";
        try {
          await preview.goto(BASE + "#" + payload + "~", { timeout: 8000 });
          await preview.waitForFunction(() =>
            document.getElementById("r-dest")?.textContent, { timeout: 5000 });
          dest = (await preview.textContent("#r-dest")).trim();
        } catch { /* recorded below */ }
        check("a link still decodes with the network gone",
          dest === "https://example.com/offline/works", dest.slice(0, 50));
        await preview.close();
      }
      await context.setOffline(false);
      await airplane.close();
    }
    await offlinePage.close();
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
      rows === 5 && won, `${rows} rows, template won: ${won}`);
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

  // Out of dist/ on purpose: dist is exactly what deploys, nothing else.
  await page.screenshot({ path: path.join(tmpdir(), "clent-screenshot-mobile.png") })
    .catch(() => {});
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
