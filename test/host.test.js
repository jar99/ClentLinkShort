/**
 * The host field and the host body mode: suffix terminals, the escape path,
 * and the flag combinations the decoder must refuse.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  shorten, expand, analyze, build, BitWriter, BitReader, ClentError,
  hostBits, emitHost, decodeHost,
  SCHEME_HTTPS, SCHEME_OTHER, F_WWW, F_HOST, MODE_HOST, MODE_TEXT,
  SCHEME_IN_BODY,
} from "../src/clent.js";
import { HOST_CODE_LENGTHS, SUFFIX_BASE, SUFFIXES } from "../src/hostcode.js";

/** Round-trip a bare host through the field codec. */
function fieldTrip(host) {
  const w = new BitWriter();
  emitHost(w, host);
  return decodeHost(new BitReader(w.finish()));
}

test("hosts round-trip through the field codec", () => {
  for (const host of [
    "example.com",            // the headline case: name + .com terminal
    "example.co.uk",          // multi-label suffix
    "sub.domain.example.org", // subdomains spelled, suffix terminal
    "myproject.github.io",    // platform suffix
    "xn--nxasmq6b.example",   // punycode name, unlisted ending
    "no-such-tld.zz",         // nothing matches: plain END
    "a.b",                    // shortest possible dotted host
    "localhost",              // no dot at all
    "127.0.0.1",              // IP literal — digits and dots
    "example.com:8080",       // port rides the ESC path for ":"
    "under_score.example",    // "_" is legal in URL hosts
  ]) {
    assert.equal(fieldTrip(host), host);
  }
});

test("a suffix the table knows costs less than spelling it", () => {
  // ".com" as a terminal must undercut its four spelled characters — that
  // is the entire reason the host mode exists.
  const spelled = ".com".split("").reduce(
    (bits, ch) => bits + (HOST_CODE_LENGTHS[ch.charCodeAt(0)] || 23),
    hostBits("example"));
  assert.ok(hostBits("example.com") < spelled,
    `terminal ${hostBits("example.com")} bits should beat spelling ~${spelled}`);
});

test("unknown domains win the host mode end to end", async () => {
  // A domain nobody has ever seen must still get the compact treatment.
  const a = await analyze("https://totally-unseen-domain-xyz.com/some/path", {
    stripTracking: false,
  });
  assert.equal(a.modeName, "host");
  assert.equal((await expand(a.payload)).href,
    "https://totally-unseen-domain-xyz.com/some/path");
});

test("www still folds to a header bit under the host mode", async () => {
  const a = await analyze("https://www.unseen-domain-abc.org/x", { stripTracking: false });
  assert.equal(a.modeName, "host");
  assert.equal((await expand(a.payload)).href, "https://www.unseen-domain-abc.org/x");
  // The stripped spelling must not cost the four "www." characters.
  const bare = await shorten("https://unseen-domain-abc.org/x", { stripTracking: false });
  assert.ok(a.payload.length <= bare.length + 1);
});

test("a host past the decoder's cap still round-trips, via another mode", async () => {
  // hostBits() must price such a host at Infinity so the host shape never
  // wins — winning would produce a payload our own decoder refuses.
  const label = "a-long-label-of-twenty-chars".slice(0, 20);
  const host = Array.from({ length: 14 }, () => label).join(".") + ".com"; // ~294 chars
  const url = `https://${host}/x`;
  const a = await analyze(url, { stripTracking: false });
  assert.notEqual(a.modeName, "host", "the host mode must not win past the cap");
  assert.equal((await expand(a.payload)).href, url);
  assert.equal(hostBits(host), Infinity);
});

test("host mode with the dictionary flag is refused", async () => {
  const w = new BitWriter();
  w.push(SCHEME_HTTPS | F_HOST | (MODE_HOST << 4), 6);
  w.push(0, 8);
  await assert.rejects(() => expand(w.finish()), ClentError);
});

test("host mode under scheme 2 is refused", async () => {
  const w = new BitWriter();
  w.push(SCHEME_OTHER | (MODE_HOST << 4), 6);
  w.push(SCHEME_IN_BODY, 4);
  await assert.rejects(() => expand(w.finish()), ClentError);
});

test("an empty host field is refused", async () => {
  // Header then an immediate END symbol: no host at all.
  const payload = build(SCHEME_HTTPS, MODE_HOST, null, new Uint8Array(0), null, "");
  await assert.rejects(() => expand(payload), ClentError, "no host");
});

test("a damaged host field fails loudly, never silently", async () => {
  const good = await shorten("https://unseen-domain-abc.org/x", { stripTracking: false });
  let failures = 0;
  for (let i = 0; i < good.length; i++) {
    for (const replacement of ["A", "z", "9", "_"]) {
      if (good[i] === replacement) continue;
      const bad = good.slice(0, i) + replacement + good.slice(i + 1);
      try {
        await expand(bad); // a different-but-valid URL is acceptable
      } catch (error) {
        assert.ok(error instanceof ClentError,
          `flip at ${i}: threw ${error.constructor.name}`);
        failures++;
      }
    }
  }
  assert.ok(failures > 0, "at least some corruptions must be caught");
});

test("the host code tables hold their wire invariants", () => {
  // The lengths array must describe a usable canonical code.
  assert.equal(HOST_CODE_LENGTHS.length, SUFFIX_BASE + SUFFIXES.length);
  let kraft = 0;
  for (const length of HOST_CODE_LENGTHS) {
    assert.ok(length >= 0 && length <= 15, `code length ${length} out of range`);
    if (length) kraft += 2 ** -length;
  }
  assert.ok(kraft <= 1 + 1e-9, `Kraft sum ${kraft} > 1: the code is ambiguous`);

  // Suffixes: unique, dotted, lowercase ASCII, and every one coded.
  assert.equal(new Set(SUFFIXES).size, SUFFIXES.length, "duplicate suffix");
  for (let i = 0; i < SUFFIXES.length; i++) {
    const suffix = SUFFIXES[i];
    assert.match(suffix, /^\.[a-z0-9.-]+$/, `suffix ${suffix} malformed`);
    assert.ok(HOST_CODE_LENGTHS[SUFFIX_BASE + i] > 0, `suffix ${suffix} uncoded`);
  }
});
