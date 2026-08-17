/**
 * Degenerate and hostile input: the guarantees that make "any URL" safe.
 *
 * The codec promises a hard edge everywhere — an input too large to be real,
 * a payload that decompresses without end, an unassigned symbol — and that
 * every edge is a ClentError with a user-showable message, never a hang, an
 * allocation blowup, or a silently invented byte.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  shorten, expand, parse, build, BitWriter, ClentError,
  MAX_URL, MAX_PAYLOAD, MODE_DEFLATE, SCHEME_OTHER, SCHEME_IN_BODY,
} from "../src/clent.js";
import { deflate, inflate, MAX_INFLATED } from "../src/deflate.js";
import { fill } from "../src/templates.js";
import { sign } from "../src/sign.js";

test("oversized input is refused with a message, not chewed on", async () => {
  const huge = "https://example.com/" + "a".repeat(MAX_URL);
  await assert.rejects(() => shorten(huge), ClentError);
  assert.throws(() => parse(huge), ClentError);

  // Just inside the cap must still work.
  const fits = "https://example.com/" + "a".repeat(MAX_URL - 100);
  const payload = await shorten(fits, { stripTracking: false });
  assert.equal((await expand(payload)).href, fits);
});

test("oversized payloads are refused before any decoding", async () => {
  await assert.rejects(() => expand("A".repeat(MAX_PAYLOAD + 1)), ClentError);
});

test("a decompression bomb is cut off small, not materialised", async () => {
  // ~10 MB of zeros compresses to a few kilobytes: a payload comfortably
  // under MAX_PAYLOAD whose honest inflation is ~600x past MAX_INFLATED.
  const zipped = await deflate(new Uint8Array(10 * 1024 * 1024));
  assert.ok(zipped, "this runtime should be able to compress");

  const payload = build(SCHEME_OTHER, MODE_DEFLATE, null, zipped, SCHEME_IN_BODY);
  assert.ok(payload.length <= MAX_PAYLOAD,
    `bomb payload should fit the length cap (${payload.length}) or this test proves nothing`);

  const started = performance.now();
  await assert.rejects(() => expand(payload), (error) => {
    assert.ok(error instanceof ClentError);
    assert.match(error.message, /too large/);
    return true;
  });
  // Generous bound — the point is "aborted early", not a benchmark.
  assert.ok(performance.now() - started < 2000, "the bomb should be rejected quickly");
});

test("inflate itself enforces the bound", async () => {
  const zipped = await deflate(new Uint8Array(MAX_INFLATED * 4));
  await assert.rejects(() => inflate(zipped), (error) => {
    assert.ok(error instanceof ClentError);
    assert.match(error.message, /too large/);
    return true;
  });
  // At the bound is fine.
  const okZipped = await deflate(new Uint8Array(MAX_INFLATED));
  assert.equal((await inflate(okZipped)).length, MAX_INFLATED);
});

test("the unassigned text6 symbol is rejected, not invented", async () => {
  // header: scheme https, no flags, mode text6 -> 0; then symbol 60; then END.
  const w = new BitWriter();
  w.push(0, 6);
  w.push(60, 6);
  w.push(63, 6);
  await assert.rejects(() => expand(w.finish()), (error) => {
    assert.ok(error instanceof ClentError, `threw ${error?.name}`);
    return true;
  });
});

test("BitWriter refuses widths it cannot carry", () => {
  const w = new BitWriter();
  assert.throws(() => w.push(0, 9), RangeError);
  assert.doesNotThrow(() => w.push(255, 8));
});

test("templates and sign fail with ClentError, like everything else", async () => {
  assert.throws(() => fill(9999, []), ClentError);
  await assert.rejects(() => sign("payload", ""), ClentError);
});
