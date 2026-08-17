/**
 * Integrity checks and signatures.
 *
 * The claims being tested are narrow on purpose. A checksum catches accidents.
 * A signature proves the maker knew a passphrase. Neither says anything about
 * whether the destination is safe, and the tests are written so that a future
 * change which quietly weakens either one fails here.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  checksum, sign, split, join, verify, TAG_CHECK, TAG_SIGNED,
} from "../src/sign.js";
import { shorten, expand } from "../src/clent.js";

const PAYLOAD = await shorten("https://example.com/a/reasonable/path?a=1", {
  stripTracking: false,
});

test("a tag does not change where the link goes", async () => {
  // The tag rides alongside the payload, never inside it, so stripping one
  // leaves a link that still works.
  const tagged = join(PAYLOAD, TAG_CHECK, await checksum(PAYLOAD));
  const { payload } = split(tagged);
  assert.equal(payload, PAYLOAD);
  assert.equal((await expand(payload)).href, (await expand(PAYLOAD)).href);
});

test("splitting handles links with and without a tag", async () => {
  assert.deepEqual(split(PAYLOAD), { payload: PAYLOAD, kind: null, tag: "" });

  const checked = split(join(PAYLOAD, TAG_CHECK, "abcd"));
  assert.deepEqual(checked, { payload: PAYLOAD, kind: TAG_CHECK, tag: "abcd" });

  const signed = split(join(PAYLOAD, TAG_SIGNED, "abcdefgh"));
  assert.deepEqual(signed, { payload: PAYLOAD, kind: TAG_SIGNED, tag: "abcdefgh" });

  // A full stop that isn't a tag marker is left alone rather than guessed at.
  assert.equal(split("abc.xyz").kind, null);
  assert.equal(split("abc.xyz").payload, "abc.xyz");
});

test("a checksum catches every single-character change", async () => {
  const tag = await checksum(PAYLOAD);
  let mutations = 0;
  for (let i = 0; i < PAYLOAD.length; i++) {
    for (const character of "AZaz09-_") {
      if (PAYLOAD[i] === character) continue;
      const mutated = PAYLOAD.slice(0, i) + character + PAYLOAD.slice(i + 1);
      mutations++;
      const result = await verify(mutated, TAG_CHECK, tag);
      assert.equal(result.ok, false, `missed a change at ${i} to "${character}"`);
    }
  }
  assert.ok(mutations > 50, "the sweep should actually have mutated things");
  assert.equal((await verify(PAYLOAD, TAG_CHECK, tag)).ok, true);
});

test("a checksum catches truncation, which is how links really break", async () => {
  const tag = await checksum(PAYLOAD);
  for (let cut = 1; cut < PAYLOAD.length; cut++) {
    assert.equal((await verify(PAYLOAD.slice(0, cut), TAG_CHECK, tag)).ok, false,
      `truncation to ${cut} characters slipped through`);
  }
});

test("a truncated or empty TAG fails, never quietly verifies weaker", async () => {
  // verify() recomputes at the presented tag's length, so without a floor an
  // empty tag would compare "" to "" and pass.
  const tag = await checksum(PAYLOAD);
  for (let cut = 0; cut < tag.length; cut++) {
    assert.equal((await verify(PAYLOAD, TAG_CHECK, tag.slice(0, cut))).ok, false,
      `a ${cut}-character checksum tag slipped through`);
  }
  const mac = await sign(PAYLOAD, "pass");
  for (let cut = 0; cut < mac.length; cut++) {
    assert.equal((await verify(PAYLOAD, TAG_SIGNED, mac.slice(0, cut), "pass")).ok, false,
      `a ${cut}-character signature tag slipped through`);
  }
  // Absurdly long tags are refused too, not recomputed at silly widths.
  assert.equal((await verify(PAYLOAD, TAG_CHECK, "A".repeat(64))).ok, false);
});

test("a signature needs the right passphrase", async () => {
  const tag = await sign(PAYLOAD, "correct horse");
  assert.equal((await verify(PAYLOAD, TAG_SIGNED, tag, "correct horse")).ok, true);
  assert.equal((await verify(PAYLOAD, TAG_SIGNED, tag, "correct horse ")).ok, false);
  assert.equal((await verify(PAYLOAD, TAG_SIGNED, tag, "wrong")).ok, false);
  assert.equal((await verify(PAYLOAD, TAG_SIGNED, tag, "")).reason, "needs-passphrase");
});

test("a signature is bound to its exact payload", async () => {
  const tag = await sign(PAYLOAD, "key");
  const other = await shorten("https://example.com/somewhere/else", { stripTracking: false });
  assert.notEqual(other, PAYLOAD);
  assert.equal((await verify(other, TAG_SIGNED, tag, "key")).ok, false,
    "a signature must not transfer to a different destination");
});

test("different passphrases give different signatures", async () => {
  const a = await sign(PAYLOAD, "one");
  const b = await sign(PAYLOAD, "two");
  assert.notEqual(a, b);
});

test("tags are URL-safe and the length that was asked for", async () => {
  for (const chars of [4, 8, 16, 24]) {
    const check = await checksum(PAYLOAD, chars);
    const signature = await sign(PAYLOAD, "key", chars);
    assert.equal(check.length, chars);
    assert.equal(signature.length, chars);
    assert.match(check, /^[A-Za-z0-9_-]+$/);
    assert.match(signature, /^[A-Za-z0-9_-]+$/);
  }
});

test("signing is deterministic", async () => {
  const first = await sign(PAYLOAD, "key");
  for (let i = 0; i < 3; i++) assert.equal(await sign(PAYLOAD, "key"), first);
});

test("a checksum is not a signature", async () => {
  // Anyone can recompute a keyless checksum for a payload they altered. This
  // is the documented limit, asserted so nobody later mistakes one for the
  // other and writes a stronger claim into the UI.
  const attackersPayload = await shorten("https://evil.example/", { stripTracking: false });
  const forged = await checksum(attackersPayload);
  assert.equal((await verify(attackersPayload, TAG_CHECK, forged)).ok, true,
    "a checksum is forgeable by construction — it detects accidents, not attackers");

  // A signature is not forgeable without the passphrase.
  const forgedSignature = await sign(attackersPayload, "attacker guess");
  assert.equal((await verify(attackersPayload, TAG_SIGNED, forgedSignature, "real key")).ok,
    false);
});
