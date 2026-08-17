/**
 * Wire v6 scheme table: non-http links are first-class, and the reserved
 * parts of the 4-bit index stay strict.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  shorten, expand, analyze, parse, build, BitWriter, ClentError,
  SCHEME_OTHER, SCHEME_IN_BODY, MODE_TEXT, MODE_RAW,
  ENCODABLE_ORDER, SCHEME_BITS, F_WWW, F_HOST,
} from "../src/clent.js";

test("every scheme in the table round-trips through its index", async () => {
  const samples = {
    "http:": "http://example.com/x",       // compact path, not scheme-2
    "https:": "https://example.com/x",     // compact path, not scheme-2
    "mailto:": "mailto:someone@example.com?subject=Hi%20there",
    "ftp:": "ftp://files.example.org/pub/thing.tar.gz",
    "ftps:": "ftps://files.example.org/secure",
    "tel:": "tel:+15551234567",
    "sms:": "sms:+15551234567",
    "magnet:": "magnet:?xt=urn:btih:abcdef0123456789",
    "ipfs:": "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "ipns:": "ipns://k51qzi5uqu5dgutdk6i1ynyzg",
    "geo:": "geo:37.786971,-122.399677",
    "matrix:": "matrix:r/somewhere:example.org",
    "xmpp:": "xmpp:someone@example.com",
  };
  for (const scheme of ENCODABLE_ORDER) {
    const url = samples[scheme];
    assert.ok(url, `no sample for ${scheme}`);
    const payload = await shorten(url, { stripTracking: false });
    assert.equal((await expand(payload)).href, parse(url).href, url);
  }
});

test("the scheme index beats spelling the scheme out", async () => {
  // The whole point of the table: 4 bits instead of the scheme's characters.
  for (const url of ["mailto:a@b.example", "tel:+15551234567", "ftp://h.example/f"]) {
    const viaIndex = await shorten(url, { stripTracking: false });
    const body = new TextEncoder().encode(url);
    const spelled = build(SCHEME_OTHER, MODE_TEXT, null, body, SCHEME_IN_BODY);
    assert.ok(viaIndex.length < spelled.length,
      `${url}: index form ${viaIndex.length} should beat spelled form ${spelled.length}`);
    // Both must decode identically.
    assert.equal((await expand(viaIndex)).href, (await expand(spelled)).href);
  }
});

test("userinfo URLs no longer pay for their scheme", async () => {
  const a = await analyze("https://user:pw@example.com/x", { stripTracking: false });
  assert.equal(a.headerBits, 6 + SCHEME_BITS);
  assert.equal((await expand(a.payload)).href, "https://user:pw@example.com/x");
});

test("unknown scheme indices are rejected, not guessed", async () => {
  for (let index = ENCODABLE_ORDER.length; index < 15; index++) {
    const w = new BitWriter();
    w.push(SCHEME_OTHER | (MODE_RAW << 4), 6);
    w.push(index, SCHEME_BITS);
    for (const byte of new TextEncoder().encode("//x.example/")) w.push(byte, 8);
    await assert.rejects(() => expand(w.finish()), (error) => {
      assert.ok(error instanceof ClentError);
      assert.match(error.message, /newer scheme table/);
      return true;
    }, `index ${index}`);
  }
});

test("the spelled-scheme escape hatch works and stays gated", async () => {
  // A valid URL through index 15 decodes...
  const good = build(SCHEME_OTHER, MODE_TEXT, null,
    new TextEncoder().encode("https://example.com/x"), SCHEME_IN_BODY);
  assert.equal((await expand(good)).href, "https://example.com/x");

  // ...and a dangerous one is still refused by the final gate.
  const bad = build(SCHEME_OTHER, MODE_RAW, null,
    new TextEncoder().encode("javascript:alert(1)"), SCHEME_IN_BODY);
  await assert.rejects(() => expand(bad), ClentError);
});

test("scheme-2 payloads with host bits set are malformed", async () => {
  for (const extra of [F_WWW, F_HOST, F_WWW | F_HOST]) {
    const w = new BitWriter();
    w.push(SCHEME_OTHER | extra | (MODE_RAW << 4), 6);
    w.push(2, SCHEME_BITS); // mailto
    for (const byte of new TextEncoder().encode("a@b.example")) w.push(byte, 8);
    await assert.rejects(() => expand(w.finish()), ClentError, `flags ${extra}`);
  }
});

test("build refuses a scheme-2 payload without an index", () => {
  assert.throws(
    () => build(SCHEME_OTHER, MODE_RAW, null, new Uint8Array([47])),
    ClentError);
});
