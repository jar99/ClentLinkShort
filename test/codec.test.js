import test from "node:test";
import assert from "node:assert/strict";
import {
  shorten, expand, analyze, parse, HOSTS,
  MODE_TEXT, MODE_RAW, MODE_DEFLATE, ClentError,
} from "../src/clent.js";
import { roundTrip } from "./helpers.js";

test("ordinary URLs round-trip", async () => {
  for (const url of [
    "https://example.com",
    "https://example.com/",
    "https://www.example.com/path/to/page",
    "http://example.com/plain",
    "https://github.com/anthropics/claude-code/blob/main/README.md",
    "https://en.wikipedia.org/wiki/Uniform_Resource_Locator#Syntax",
    "https://sub.domain.example.co.uk/deep/path/segment/here",
  ]) {
    await roundTrip(url, { stripTracking: false });
  }
});

test("awkward URLs round-trip", async () => {
  for (const url of [
    "http://example.com:8080/x?y=1#frag",       // non-default port
    "https://user:pw@example.com/secure",       // userinfo, stored verbatim
    "https://example.com/unicode/каталог/日本語?q=café",
    "https://example.com/path%20with%20spaces/and+plus",
    "https://example.com/x?",                   // empty query must survive
    "https://example.com/x#",                   // empty fragment must survive
    "https://example.com/?#",
    "https://example.com/a?b=c&b=d&b=e",        // repeated keys
    "https://example.com/" + "a".repeat(2000),  // long
    "https://xn--bcher-kva.example/ü",          // punycode host
    "https://192.168.0.1:3000/admin",           // IPv4 literal
    "https://[2001:db8::1]:8080/x",             // IPv6 literal
    "https://example.com/;,/?:@&=+$-_.!~*'()#", // every sub-delim
    "https://example.com/%00%01%02",            // encoded control bytes
  ]) {
    await roundTrip(url, { stripTracking: false });
  }
});

test("non-http schemes round-trip verbatim", async () => {
  for (const url of [
    "mailto:someone@example.com?subject=Hi%20there",
    "ftp://files.example.org/pub/thing.tar.gz",
    "magnet:?xt=urn:btih:abcdef0123456789",
    "tel:+15551234567",
  ]) {
    await roundTrip(url);
  }
});

test("a missing scheme is assumed to be https", async () => {
  assert.equal((await expand(await shorten("example.com/bare"))).href,
    "https://example.com/bare");
  assert.equal((await expand(await shorten("  example.com  "))).href,
    "https://example.com/");
});

test("tracking parameters are stripped, and only those", async () => {
  const cases = [
    ["https://a.example/p?utm_source=x&utm_medium=y", "https://a.example/p"],
    ["https://a.example/p?a=1&fbclid=XYZ&b=2", "https://a.example/p?a=1&b=2"],
    ["https://a.example/p?gclid=1&msclkid=2&igshid=3", "https://a.example/p"],
    // Real parameters that merely look like tracking must survive.
    ["https://a.example/p?id=1&ref=friend&q=utm_source", "https://a.example/p?id=1&ref=friend&q=utm_source"],
    ["https://a.example/p?utmost=1", "https://a.example/p?utmost=1"],
  ];
  for (const [input, expected] of cases) {
    const out = await expand(await shorten(input, { stripTracking: true }));
    assert.equal(out.href, expected, input);
  }
});

test("tracking stripping can be turned off", async () => {
  const url = "https://a.example/p?utm_source=x";
  assert.equal((await expand(await shorten(url, { stripTracking: false }))).href, url);
});

test("analysis reports which parameters were dropped", async () => {
  const a = await analyze("https://a.example/p?utm_source=x&fbclid=y&keep=1");
  assert.deepEqual(a.removed.sort(), ["fbclid", "utm_source"]);
  assert.equal(a.url.href, "https://a.example/p?keep=1");
});

test("every dictionary host encodes and decodes", async () => {
  // The probe path is chosen so no template can absorb it — a single segment
  // with a capital and a tilde is outside every slot charset, and the
  // all-text template slots all sit behind multi-segment or literal shapes.
  //
  // Every entry must round-trip. The cheap-index head (3 or 11 bits) must
  // also WIN the race; past index 261 the escape-coded index costs 19 bits
  // and a short host can legitimately beat its own dictionary entry by
  // spelling itself — the optimizer picking that is correct, not a miss.
  const { indexBits } = await import("../src/bits.js");
  for (const host of HOSTS) {
    const index = HOSTS.indexOf(host);
    const a = await analyze(`https://${host}/Probe~9`, { stripTracking: false });
    if (indexBits(index) <= 11) {
      assert.equal(a.hostByte, index, `${host} should hit the dictionary`);
    }
    assert.equal((await expand(a.payload)).href, `https://${host}/Probe~9`);
  }
});

test("a bare dictionary host costs almost nothing", async () => {
  const payload = await shorten("https://github.com");
  assert.ok(payload.length <= 4, `expected <= 4 chars, got ${payload.length}`);
  assert.equal((await expand(payload)).href, "https://github.com/");
});

test("the shortest body mode wins", async () => {
  // Ordinary lowercase text is squarely the text mode's home ground; a
  // dictionary host keeps the host field out of the race.
  const lower = await analyze("https://github.com/a/lowercase/path/of/words", { stripTracking: false });
  assert.equal(lower.mode, MODE_TEXT);
  assert.ok(lower.candidates.text < lower.candidates.raw);

  // A long repetitive URL is where DEFLATE finally pays for its overhead.
  const long = await analyze("https://example.com/" + "abcdefgh/".repeat(60), { stripTracking: false });
  assert.equal(long.mode, MODE_DEFLATE);

  // Whichever mode is chosen, it must be the shortest one available.
  for (const a of [lower, long]) {
    const lengths = Object.values(a.candidates).filter((n) => n !== null);
    assert.equal(a.payload.length, Math.min(...lengths));
  }
});

test("analysis bit accounting adds up", async () => {
  const { indexBits } = await import("../src/bits.js");
  const { HEADER_CODE_LENGTHS, F_HOST } = await import("../src/clent.js");
  for (const url of ["https://github.com/x", "https://not-in-dictionary.example/x/y"]) {
    const a = await analyze(url, { stripTracking: false });
    const flags = (a.hostByte === null ? 0 : F_HOST) | (a.mode << 4);
    assert.equal(a.headerBits, HEADER_CODE_LENGTHS[flags] +
      (a.hostByte === null ? 0 : indexBits(a.hostByte)));
    assert.equal(a.headerBits + a.bodyBits, a.payload.length * 6);
  }
});

test("payloads use only fragment-safe characters", async () => {
  for (const url of [
    "https://example.com/~tilde/and!bang",
    "https://example.com/日本語",
    "https://ex.example/" + "z".repeat(500),
  ]) {
    assert.match(await shorten(url), /^[A-Za-z0-9_-]+$/, url);
  }
});

test("encoding is deterministic", async () => {
  const url = "https://example.com/stable?a=1&b=2#c";
  const first = await shorten(url);
  for (let i = 0; i < 5; i++) assert.equal(await shorten(url), first);
});

test("forcing each mode still decodes correctly", async () => {
  // Guards the modes that would otherwise only be exercised when they win.
  const { build } = await import("../src/clent.js");
  const body = new TextEncoder().encode("example.com/forced/path");
  for (const mode of [MODE_TEXT, MODE_RAW]) {
    const payload = build(0, mode, null, body);
    assert.equal((await expand(payload)).href, "https://example.com/forced/path");
  }
});

test("input is rejected before it can be encoded", async () => {
  for (const bad of ["", "   ", "javascript:alert(1)", "data:text/html,<script>",
                     "vbscript:x", "blob:https://x/y", "file:///etc/passwd", "https://"]) {
    await assert.rejects(() => shorten(bad), ClentError, `should reject ${JSON.stringify(bad)}`);
  }
});

test("a URL instance is validated like a string", async () => {
  await assert.rejects(() => shorten(new URL("javascript:alert(1)")), ClentError);
  assert.equal(await shorten(new URL("https://example.com/x")),
               await shorten("https://example.com/x"));
});

test("the token dictionary shortens what it should", async () => {
  // Compared at the text-candidate level with equal-length bodies: one made
  // of dictionary tokens, one of deliberately token-free letters. The exact
  // saving depends on the mined code, so the assertion is directional plus a
  // sanity margin, not arithmetic.
  const { TOKENS } = await import("../src/clent.js");
  const { textBits } = await import("../src/text.js");
  const encoder = new TextEncoder();

  const token = TOKENS.find((t) => t.length >= 6 && /^[a-z/.]+$/.test(t));
  assert.ok(token, "expected at least one long lowercase token");
  const body = token.repeat(8);
  const control = "qzxvbj".repeat(Math.ceil(body.length / 6)).slice(0, body.length);

  const tokenised = textBits(encoder.encode(body));
  const plain = textBits(encoder.encode(control));
  assert.ok(tokenised < plain * 0.7,
    `tokenised body (${tokenised} bits) should be far below token-free (${plain} bits)`);
});

test("token selection is optimal against the shipped cost model", async () => {
  // An independent shortest-path over the same published tables: for a set of
  // bodies, no split into tokens and literals may beat what emitText chose.
  const { textBits } = await import("../src/text.js");
  const { CODE_LENGTHS, SYM_END, SYM_ESC, TOKEN_BASE, TOKENS } =
    await import("../src/textcode.js");
  const encoder = new TextEncoder();

  const literalCost = (byte) => CODE_LENGTHS[byte] || CODE_LENGTHS[SYM_ESC] + 8;


  for (const body of [
    "article-news-media/index.html",
    "the-article-of-the-day",
    "en.m.wikipedia.org/wiki/thing",
    "storage.example/portal/technology?id=1",
    "MiXeD_Case/With%20Escapes",
  ]) {
    const bytes = encoder.encode(body);
    const best = new Array(bytes.length + 1).fill(Infinity);
    best[bytes.length] = CODE_LENGTHS[SYM_END];
    for (let i = bytes.length - 1; i >= 0; i--) {
      best[i] = literalCost(bytes[i]) + best[i + 1];
      for (let t = 0; t < TOKENS.length; t++) {
        const token = TOKENS[t];
        // Each token is its own symbol: its cost is its own code length.
        if (CODE_LENGTHS[TOKEN_BASE + t] && body.startsWith(token, i)) {
          best[i] = Math.min(best[i],
            CODE_LENGTHS[TOKEN_BASE + t] + best[i + token.length]);
        }
      }
    }
    assert.equal(textBits(bytes), best[0],
      `${body}: emitText planned ${textBits(bytes)} bits, independent DP says ${best[0]}`);
  }
});

test("shopping and social tracking is removed without breaking the link", async () => {
  const cases = [
    // Amazon: affiliate tag and referral crumbs go, the variant selector stays.
    ["https://www.amazon.com/dp/B08N5WRWNW/ref=sr_1_3?tag=aff-20&th=1&pd_rd_w=abc",
     "https://www.amazon.com/dp/B08N5WRWNW?th=1"],  // path rule folds /ref= away
    // eBay campaign parameters.
    ["https://www.ebay.com/itm/123?_trkparms=x&campid=5338&mkevt=1",
     "https://www.ebay.com/itm/123"],
    // X marks shares with s and t; both are host-scoped.
    ["https://x.com/user/status/1234?s=20&t=abcdef", "https://x.com/user/status/1234"],
    // ...but s and t elsewhere are ordinary parameters and must survive.
    ["https://example.com/search?s=query&t=1", "https://example.com/search?s=query&t=1"],
    ["https://www.tiktok.com/@u/video/7123?is_from_webapp=1&web_id=9",
     "https://www.tiktok.com/@u/video/7123"],
    ["https://www.youtube.com/watch?v=abc&si=xyz&feature=share",
     "https://www.youtube.com/watch?v=abc"],
    ["https://www.instagram.com/p/Cabc/?igshid=xyz", "https://www.instagram.com/p/Cabc/"],
    // A product page with nothing to strip must come out untouched.
    ["https://www.etsy.com/listing/123/handmade-thing",
     "https://www.etsy.com/listing/123/handmade-thing"],
  ];
  for (const [input, expected] of cases) {
    const out = await expand(await shorten(input, { stripTracking: true }));
    assert.equal(out.href, expected, input);
  }
});

test("removing tracking never changes the path or host", async () => {
  // The switch is meant to drop parameters, not rewrite where a link points.
  const { analyze } = await import("../src/clent.js");
  for (const url of [
    "https://www.amazon.co.uk/dp/B01?tag=x&ref=y",
    "https://shop.example/p/1?utm_source=a&size=large",
    "https://x.com/i/web/status/1?s=46",
  ]) {
    const before = new URL(url);
    const after = (await analyze(url, { stripTracking: true })).url;
    assert.equal(after.hostname, before.hostname, url);
    assert.equal(after.pathname, before.pathname, url);
    assert.equal(after.protocol, before.protocol, url);
  }
});
