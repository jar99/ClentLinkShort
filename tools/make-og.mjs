#!/usr/bin/env node
/**
 * Draw the link-preview card, once, into a committed PNG.
 *
 * Chat apps and search results show an image when a link is shared, and they
 * fetch it themselves — so unlike everything else here it has to be a real
 * raster file at a real URL, not something the page assembles. There is no
 * image pipeline in this project and no reason to grow one for a single
 * picture, so this renders an HTML card in the browser the tests already use
 * and screenshots it. The PNG is committed; the build only copies it.
 *
 *   npm run og            # rewrite src/og.png
 *
 * Regenerating needs Playwright and a machine with Liberation Sans or DejaVu
 * Sans, which is what the committed file was rendered with. If the type looks
 * different afterwards, that is the font substituting, not the card changing.
 *
 * 1200x630 is the size every consumer of og:image agrees on; Twitter's
 * summary_large_image crops it least at that ratio.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { origin } from "../clent.config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "og.png");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright");
  process.exit(2);
}

// The page's own dark palette and its own wordmark, so a preview looks like
// the thing it opens rather than like a banner someone made separately.
const CARD = `<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #121210;
    color: #eeece2;
    font-family: "Liberation Sans", "DejaVu Sans", sans-serif;
    padding: 96px 92px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 30px;
  }
  .mark { display: flex; align-items: center; gap: 16px; }
  .mark span { font-size: 34px; font-weight: 700; letter-spacing: .01em; }
  h1 { font-size: 74px; line-height: 1.08; font-weight: 700; letter-spacing: -.02em; }
  p { font-size: 31px; line-height: 1.45; color: #a5a196; max-width: 40ch; }
  .host {
    margin-top: 6px; font-size: 27px; color: #d4522a; font-weight: 700;
    letter-spacing: .02em;
  }
  /* The three segment colours the page uses to show what a payload is made
     of — header, host, body. A thin edge rather than a panel: it should read
     as this site's stripe, not compete with the sentence. */
  .bars { position: absolute; left: 0; bottom: 0; width: 1200px; height: 12px;
          display: flex; }
  .bars i { height: 12px; }
</style>
<div class="bars">
  <i style="background:#b4471c;width:46%"></i>
  <i style="background:#b8860b;width:22%"></i>
  <i style="background:#4a6fa5;width:32%"></i>
</div>
<div class="mark">
  <svg viewBox="0 0 24 24" width="38" height="38" fill="none" stroke="#eeece2"
       stroke-width="2.1" stroke-linecap="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
  <span>Clent</span>
</div>
<h1>The link shortener<br>that stores nothing.</h1>
<p>The whole URL is compressed into the link itself. No database, no accounts,
no tracking.</p>
<div class="host">${new URL(origin).host}</div>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(CARD, { waitUntil: "load" });
  await page.screenshot({ path: OUT, type: "png" });
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
} finally {
  await browser.close();
}
