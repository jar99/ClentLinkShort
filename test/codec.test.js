import test from "node:test";
import assert from "node:assert/strict";
import {
  shorten, expand, analyze, parse, HOSTS,
  MODE_TEXT6, MODE_RAW, MODE_DEFLATE, ClentError,
} from "../src/clent.js";

/** Encode then decode, asserting the destination survives exactly. */
async function roundTrip(input, options) {
  const payload = await shorten(input, options);
  const out = await expand(payload);
  assert.equal(out.href, parse(input).href, `round-trip failed for ${input}`);
  return payload;
}

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
  for (const host of HOSTS) {
    const a = await analyze(`https://${host}/probe/path`, { stripTracking: false });
    assert.equal(a.hostByte, HOSTS.indexOf(host), `${host} should hit the dictionary`);
    assert.equal((await expand(a.payload)).href, `https://${host}/probe/path`);
  }
});

test("dictionary entries are unique and within one byte", () => {
  assert.ok(HOSTS.length <= 256, "index is 8 bits");
  assert.equal(new Set(HOSTS).size, HOSTS.length, "duplicate entries waste indices");
  for (const host of HOSTS) {
    assert.equal(host, host.toLowerCase(), `${host} must be lowercase to ever match`);
    assert.doesNotThrow(() => new URL(`https://${host}`), `${host} must be a valid host`);
  }
});

test("a bare dictionary host costs almost nothing", async () => {
  const payload = await shorten("https://github.com");
  assert.ok(payload.length <= 4, `expected <= 4 chars, got ${payload.length}`);
  assert.equal((await expand(payload)).href, "https://github.com/");
});

test("the shortest body mode wins", async () => {
  // Lowercase text: text6 packs 1 char per char, beating raw's 1.33.
  const lower = await analyze("https://example.com/a/lowercase/path/of/words", { stripTracking: false });
  assert.equal(lower.mode, MODE_TEXT6);
  assert.ok(lower.candidates.text6 < lower.candidates.raw);

  // A long repetitive URL is where DEFLATE finally pays for its overhead.
  const long = await analyze("https://example.com/" + "abcdefgh/".repeat(60), { stripTracking: false });
  assert.equal(long.mode, MODE_DEFLATE);

  // Uppercase-dense IDs cost text6 a 6-bit SHIFT per character (12 bits vs
  // raw's 8), which is the one place plain bytes win.
  const token = await analyze(
    "https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0JKLMNOPQRSTUV/view",
    { stripTracking: false });
  assert.equal(token.mode, MODE_RAW);
  assert.ok(token.candidates.raw < token.candidates.text6);

  // Whichever mode is chosen, it must be the shortest one available.
  for (const a of [lower, long, token]) {
    const lengths = Object.values(a.candidates).filter((n) => n !== null);
    assert.equal(a.payload.length, Math.min(...lengths));
  }
});

test("analysis bit accounting adds up", async () => {
  for (const url of ["https://github.com/x", "https://not-in-dictionary.example/x/y"]) {
    const a = await analyze(url, { stripTracking: false });
    assert.equal(a.headerBits, a.hostByte === null ? 6 : 14);
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
  for (const mode of [MODE_TEXT6, MODE_RAW]) {
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
