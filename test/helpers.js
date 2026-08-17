/**
 * Shared test helpers. Small on purpose: one round-trip assertion and one
 * seeded PRNG, so suites stop growing private copies that drift apart.
 */
import assert from "node:assert/strict";

import { shorten, expand, parse } from "../src/clent.js";

/**
 * Encode then decode, asserting the destination survives exactly.
 * @param {string} input
 * @param {import("../src/clent.js").ShortenOptions} [options]
 * @returns {Promise<string>} the payload
 */
export async function roundTrip(input, options) {
  const payload = await shorten(input, options);
  const out = await expand(payload);
  assert.equal(out.href, parse(input).href, `round-trip failed for ${input}`);
  return payload;
}

/**
 * Deterministic xorshift32 PRNG — reproducible across runs and platforms.
 * Seed with CLENT_SEED to replay a failing sequence.
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 0x100000000;
  };
}
