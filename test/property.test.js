/**
 * Property-based tests. Rather than checking hand-picked examples, these
 * generate many inputs and assert invariants that must hold for all of them.
 *
 * The generator is seeded so a failure is reproducible: the seed is printed
 * with any mismatch, and CLENT_SEED reruns that exact sequence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shorten, expand, parse, HOSTS, B64, ClentError } from "../src/clent.js";

const SEED = Number(process.env.CLENT_SEED) || 20240817;

import { rng } from "./helpers.js";

const ALPHABETS = [
  "abcdefghijklmnopqrstuvwxyz",
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  "0123456789",
  "-._~/?#[]@!$&'()*+,;=%",
  "éüñçøåß日本語中文한국어кириллицаالعربية🙂🔗",
  " \t<>\"\\^`{}|",
];

function makeUrl(random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const chars = (n, alphabet) => {
    let out = "";
    for (let i = 0; i < n; i++) out += alphabet[Math.floor(random() * alphabet.length)];
    return out;
  };

  const scheme = random() < 0.85 ? "https" : "http";
  // Host shapes deliberately include the awkward ones: IP literals, IPv6
  // brackets, punycode, and hosts long enough to press the decoder's cap —
  // the class of input that found the encode-but-can't-decode host bug.
  const roll = random();
  const host = roll < 0.35
    ? pick(HOSTS)
    : roll < 0.8
      ? `${random() < 0.3 ? "www." : ""}${chars(1 + Math.floor(random() * 8), ALPHABETS[0])}` +
        `.${pick(["com", "org", "net", "co.uk", "io", "example"])}`
      : roll < 0.86
        ? `${Math.floor(random() * 256)}.${Math.floor(random() * 256)}.` +
          `${Math.floor(random() * 256)}.${Math.floor(random() * 256)}`
        : roll < 0.9
          ? `[2001:db8::${Math.floor(random() * 65536).toString(16)}]`
          : roll < 0.95
            ? `xn--${chars(4 + Math.floor(random() * 8), ALPHABETS[0])}.com`
            : Array.from({ length: 5 + Math.floor(random() * 5) },
                () => chars(20 + Math.floor(random() * 40), ALPHABETS[0])).join(".");
  const port = random() < 0.1 ? `:${1 + Math.floor(random() * 65534)}` : "";

  let path = "";
  const segments = Math.floor(random() * 5);
  for (let i = 0; i < segments; i++) {
    path += "/" + chars(1 + Math.floor(random() * 15), pick(ALPHABETS));
  }
  if (!path && random() < 0.5) path = "/";

  let query = "";
  const params = Math.floor(random() * 4);
  for (let i = 0; i < params; i++) {
    query += (i ? "&" : "?") + chars(1 + Math.floor(random() * 6), ALPHABETS[1]) +
             "=" + chars(Math.floor(random() * 12), pick(ALPHABETS));
  }
  const hash = random() < 0.25 ? "#" + chars(Math.floor(random() * 10), pick(ALPHABETS)) : "";

  return `${scheme}://${host}${port}${path}${query}${hash}`;
}

test("any generated URL round-trips exactly", async () => {
  const random = rng(SEED);
  let checked = 0;

  for (let i = 0; i < 3000; i++) {
    const candidate = makeUrl(random);
    let expected;
    try {
      expected = parse(candidate).href;
    } catch {
      continue; // the generator can emit things that are not URLs at all
    }

    const payload = await shorten(candidate, { stripTracking: false });
    const actual = (await expand(payload)).href;
    assert.equal(actual, expected,
      `seed ${SEED}, iteration ${i}\n  in : ${candidate}\n  payload: ${payload}`);
    assert.match(payload, /^[A-Za-z0-9_-]+$/, `payload must stay URL-safe: ${payload}`);
    checked++;
  }

  assert.ok(checked > 2000, `expected most generated URLs to be valid, got ${checked}`);
});

test("truncating any payload never produces a wrong URL", async () => {
  // A link mangled in transit — chat clients love to clip trailing characters
  // — must fail loudly rather than resolve somewhere unintended.
  const random = rng(SEED + 1);
  for (let i = 0; i < 400; i++) {
    const url = makeUrl(random);
    let expected;
    try { expected = parse(url).href; } catch { continue; }

    const payload = await shorten(url, { stripTracking: false });
    for (let cut = 1; cut < payload.length; cut++) {
      const clipped = payload.slice(0, cut);
      try {
        const out = await expand(clipped);
        assert.notEqual(out.href, expected,
          `truncation to ${cut} chars must not still decode to the full URL`);
      } catch (error) {
        assert.ok(error instanceof ClentError, `unexpected ${error?.name} for ${clipped}`);
      }
    }
  }
});

test("flipping any character never crashes the decoder", async () => {
  const random = rng(SEED + 2);
  for (let i = 0; i < 200; i++) {
    const url = makeUrl(random);
    let payload;
    try { payload = await shorten(url, { stripTracking: false }); } catch { continue; }

    for (let attempt = 0; attempt < 8; attempt++) {
      const at = Math.floor(random() * payload.length);
      const replacement = B64[Math.floor(random() * 64)];
      const mutated = payload.slice(0, at) + replacement + payload.slice(at + 1);
      try {
        const out = await expand(mutated);
        assert.ok(out instanceof URL);
      } catch (error) {
        assert.ok(error instanceof ClentError, `unexpected ${error?.name}: ${error?.message}`);
      }
    }
  }
});

test("random fragments are always rejected or safely decoded", async () => {
  const random = rng(SEED + 3);
  for (let i = 0; i < 20000; i++) {
    let payload = "";
    const length = 1 + Math.floor(random() * 40);
    for (let k = 0; k < length; k++) payload += B64[Math.floor(random() * 64)];

    try {
      const url = await expand(payload);
      assert.match(url.protocol, /^(https?|mailto|ftps?|tel|sms|magnet|ipfs|ipns):$/,
        `${payload} decoded to ${url.protocol}`);
    } catch (error) {
      assert.ok(error instanceof ClentError, `${payload} threw ${error?.name}`);
    }
  }
});

test("payload length is stable under repeated encoding", async () => {
  // Encoding is a pure function of the canonical URL, so re-encoding what we
  // decoded must land on the identical payload.
  const random = rng(SEED + 4);
  for (let i = 0; i < 500; i++) {
    const url = makeUrl(random);
    let payload;
    try { payload = await shorten(url, { stripTracking: false }); } catch { continue; }
    const again = await shorten((await expand(payload)).href, { stripTracking: false });
    assert.equal(again, payload, `re-encoding changed the payload for ${url}`);
  }
});
