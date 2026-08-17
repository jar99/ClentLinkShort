import test from "node:test";
import assert from "node:assert/strict";
import { BitWriter, BitReader, B64, ClentError } from "../src/clent.js";
import { rng } from "./helpers.js";

test("the output alphabet is the size the format assumes", () => {
  assert.equal(B64.length, 64, "Base64url alphabet must be exactly 64 symbols");
  assert.equal(new Set(B64).size, 64, "Base64url alphabet must have no duplicates");
  assert.match(B64, /^[A-Za-z0-9_-]+$/, "alphabet must be URL-safe");
});

test("a single value round-trips at every width", () => {
  for (let width = 1; width <= 8; width++) {
    for (let value = 0; value < 1 << width; value++) {
      const w = new BitWriter();
      w.push(value, width);
      assert.equal(new BitReader(w.finish()).read(width), value, `${value}@${width}`);
    }
  }
});

test("sequences round-trip at mixed widths", () => {
  // A deterministic pseudo-random walk: reproducible, but not hand-picked.
  const random = rng(12345);
  const next = (n) => Math.floor(random() * n);

  for (let trial = 0; trial < 500; trial++) {
    const items = [];
    for (let i = next(40) + 1; i > 0; i--) {
      const width = next(8) + 1;
      items.push([next(1 << width), width]);
    }
    const w = new BitWriter();
    for (const [value, width] of items) w.push(value, width);

    const r = new BitReader(w.finish());
    for (const [value, width] of items) assert.equal(r.read(width), value);
  }
});

test("writer output is always URL-safe and correctly sized", () => {
  for (let bits = 1; bits <= 64; bits++) {
    const w = new BitWriter();
    let written = 0;
    while (written < bits) {
      const width = Math.min(8, bits - written);
      w.push((1 << width) - 1, width);
      written += width;
    }
    const out = w.finish();
    assert.equal(out.length, Math.ceil(bits / 6), `${bits} bits`);
    assert.match(out, /^[A-Za-z0-9_-]+$/);
  }
});

test("reader reports remaining bits and refuses to over-read", () => {
  const r = new BitReader("AAAA"); // 4 chars = 24 bits
  assert.equal(r.left, 24);
  r.read(6);
  assert.equal(r.left, 18);
  r.read(8);
  assert.equal(r.left, 10);
  r.read(8);
  assert.equal(r.left, 2);
  assert.throws(() => r.read(6), ClentError, "must not read past the end");
});

test("reader rejects characters outside the alphabet", () => {
  assert.throws(() => new BitReader("A*A").read(18), ClentError);
});

test("padding never fabricates a whole byte", () => {
  // 6-bit header + n bytes leaves 0-5 bits of padding; floor() must ignore it.
  for (let bytes = 0; bytes < 20; bytes++) {
    const w = new BitWriter();
    w.push(0b010001, 6);
    for (let i = 0; i < bytes; i++) w.push(0xff, 8);
    const r = new BitReader(w.finish());
    r.read(6);
    assert.equal(Math.floor(r.left / 8), bytes, `${bytes} bytes`);
  }
});
