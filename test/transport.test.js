/**
 * Transport dresses: emoji and dense ASCII. Both are exact re-encodings of
 * the canonical Base64url payload — every property here is "nothing changes
 * but the spelling", plus the marker guarantees the fragment grammar leans
 * on (preview "~" suffix, "!" prefix, "." tag separator).
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  isEmoji, toEmoji, fromEmoji, isDense, toDense, fromDense, decodeTransport,
} from "../src/transport.js";
import { B64, ClentError } from "../src/bits.js";
import { shorten, expand } from "../src/clent.js";

/** Deterministic pseudo-random Base64url payloads, every length 1..N. */
function* payloads(maxLength, perLength) {
  let seed = 0x2c1e51;
  const next = () => (seed = (seed * 48271) % 0x7fffffff);
  for (let length = 1; length <= maxLength; length++) {
    for (let i = 0; i < perLength; i++) {
      let p = "";
      for (let k = 0; k < length; k++) p += B64[next() % 64];
      yield p;
    }
  }
}

test("dense round-trips every payload length exactly", () => {
  for (const p of payloads(90, 8)) {
    const dressed = toDense(p);
    assert.ok(!isEmoji(dressed), dressed);
    // Tiny payloads may come back in canonical spelling — the one case
    // where that is the shortest dense form; every spelling decodes alike.
    assert.equal(decodeTransport(dressed), p);
    if (isDense(dressed)) assert.equal(fromDense(dressed), p);
    else assert.equal(dressed, p);
  }
});

test("emoji round-trips every payload length exactly", () => {
  for (const p of payloads(90, 8)) {
    const dressed = toEmoji(p);
    assert.ok(isEmoji(dressed), dressed);
    assert.ok(!isDense(dressed), dressed);
    assert.equal(fromEmoji(dressed), p);
    assert.equal(decodeTransport(dressed), p);
  }
});

test("dense output never collides with the fragment grammar", () => {
  let marked = 0;
  for (const p of payloads(90, 8)) {
    const dressed = toDense(p);
    // "~" appears only as a leading marker, so the preview suffix ("~" at
    // the end) and the tag separator (".") stay unambiguous; the grammar's
    // leading "!" (preview) and "s=" (prefill) are never emitted bare; and
    // a dense payload is never mistaken for canonical Base64url.
    assert.ok(!dressed.slice(1).includes("~"), dressed);
    assert.ok(!dressed.includes("."), dressed);
    assert.ok(!dressed.startsWith("!"), dressed);
    assert.ok(!dressed.startsWith("s="), dressed);
    if (dressed.startsWith("~")) marked++;
    else assert.ok(isDense(dressed) || dressed === p, dressed);
  }
  // The marker is the exception, not the rule — that is what makes dense
  // never longer than canonical.
  assert.ok(marked < 30, `${marked} of 720 payloads needed the marker`);
});

test("dense is never longer than canonical, and shorter when it matters", () => {
  for (const p of payloads(90, 4)) {
    const dressed = toDense(p);
    assert.ok(dressed.length <= p.length, `${p} -> ${dressed}`);
    if (p.length >= 24) {
      assert.ok(dressed.length < p.length, `${p} (${p.length}) -> ${dressed} (${dressed.length})`);
    }
  }
});

test("plain Base64url payloads are not detected as a dress", () => {
  for (const p of payloads(40, 4)) {
    assert.ok(!isDense(p) && !isEmoji(p), p);
    assert.equal(decodeTransport(p), p);
  }
});

test("expand() accepts the same link in all three dresses", async () => {
  const url = "https://en.wikipedia.org/wiki/Special_relativity";
  const payload = await shorten(url);
  for (const dressed of [payload, toDense(payload), toEmoji(payload)]) {
    assert.equal((await expand(dressed)).href, url, dressed);
  }
});

test("a damaged dense payload is a ClentError, never a wrong URL", () => {
  const dressed = toDense("HelloWorld42");
  // A character outside the dense alphabet.
  assert.throws(() => fromDense("~" + dressed.slice(1, -1) + "🙂"), ClentError);
  // Emptied out entirely.
  assert.throws(() => fromDense("~"), ClentError);
});

test("a damaged emoji payload is a ClentError, never a wrong URL", () => {
  assert.throws(() => fromEmoji(toEmoji("abc").slice(0, -2) + "z"), ClentError);
});
