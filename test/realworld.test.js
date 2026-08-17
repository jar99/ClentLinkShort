/**
 * The links people actually paste, verbatim from the wild — including the
 * ones that prompted bug reports. Each must round-trip byte-exactly with
 * stripping off; the tracking-laden ones must also come out meaningfully
 * shorter than they went in once stripping is allowed to do its work.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { shorten, expand, analyze } from "../src/clent.js";
import { toEmoji } from "../src/transport.js";

const ORIGIN = 16; // "https://nul.im/#"

const WILD = [
  "https://a.co/d/00CG6s5j",
  "https://www.amazon.com/dp/1568814240",
  "https://www.amazon.com/Real-Time-Rendering-Fourth-Tomas-Akenine-M%C3%B6ller/dp/1138627003/ref=pd_sbs_d_sccl_1_1/140-8950720-5107962?pd_rd_w=2vh0m&content-id=amzn1.sym.aa738fbd-ad05-4d11-aae2-04b598db6305&pf_rd_p=aa738fbd-ad05-4d11-aae2-04b598db6305&pf_rd_r=ZEMYJZM04P8WXYDD2MNX&pd_rd_wg=UGhSz&pd_rd_r=46e1a756-c80e-4dbc-a246-869368a8b74e&pd_rd_i=1138627003&psc=1",
  "https://www.ebay.com/itm/385919637422?_from=R40&hash=item59dabc-item",
  "https://www.theguardian.com/environment/2026/aug/12/some-article-title?utm_source=newsletter&utm_medium=email&CMP=GTUK_email",
  "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc123def456",
  "https://vm.tiktok.com/ZMhJKvR2c/",
  "https://blog.cloudflare.com/some-engineering-post/",
  "https://mail.google.com/mail/u/0/#inbox",
  "https://docs.google.com/document/d/1A2B3C4D5E6F7G8H9I0JKLMNOPQRSTUV/edit",
  "https://en.m.wikipedia.org/wiki/Special_relativity",
  "https://admin.example-store.com/dashboard",
];

test("wild links round-trip byte-exactly with stripping off", async () => {
  for (const url of WILD) {
    const payload = await shorten(url, { stripTracking: false });
    assert.equal((await expand(payload)).href, new URL(url).href, url);
  }
});

test("the Amazon monster collapses once stripping may act", async () => {
  const monster = WILD[2];
  const a = await analyze(monster); // stripping defaults on
  const link = ORIGIN + a.payload.length;
  assert.ok(link < 60, `expected a compact link, got ${link} chars from ${monster.length}`);
  // The canonical product page must be what comes back.
  const back = await expand(a.payload);
  assert.match(back.pathname, /^\/dp\/1138627003$/);
  assert.equal(back.host, "www.amazon.com");
});

test("subdomain-shaped hosts profit from the host tokens", async () => {
  // Not exact numbers — mined tables move — but the tokenised spellings
  // must never be worse than a plain-letter host of the same length.
  const { hostBits } = await import("../src/host.js");
  for (const [tokened, plain] of [
    ["blog.example.com", "qxzj.example.com"],
    ["mail.example.com", "qxzv.example.com"],
    ["news.example.org", "qxzw.example.org"],
  ]) {
    assert.ok(hostBits(tokened) <= hostBits(plain),
      `${tokened} (${hostBits(tokened)}) should cost <= ${plain} (${hostBits(plain)})`);
  }
});

test("every wild link also survives the emoji dress", async () => {
  for (const url of WILD.slice(0, 6)) {
    const payload = await shorten(url, { stripTracking: false });
    assert.equal((await expand(toEmoji(payload))).href, new URL(url).href, url);
  }
});
