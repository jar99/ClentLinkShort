/**
 * Invariants of the wire data tables.
 *
 * Each table's position IS its wire encoding, so these are format guarantees,
 * not style checks: sizes must fit their index widths, entries must be unique
 * (a duplicate is a wasted index), and each table documents itself as
 * append-only. Consolidated here so a table edit fails in one obvious place.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { HOSTS } from "../src/hosts.js";
import { TOKENS, CODE_LENGTHS, TOKEN_INDEX_BITS, SYM_TOKEN, SYM_END, SYM_ESC } from "../src/textcode.js";
import { TEMPLATES, CHARSETS } from "../src/templates.js";
import { ENCODABLE_ORDER, SCHEME_IN_BODY, ENCODABLE, FOLLOWABLE } from "../src/schemes.js";

test("HOSTS fits its 8-bit index and every entry is usable", () => {
  assert.ok(HOSTS.length <= 256, "index is 8 bits");
  assert.equal(new Set(HOSTS).size, HOSTS.length, "duplicate entries waste indices");
  for (const host of HOSTS) {
    assert.equal(host, host.toLowerCase(), `${host} must be lowercase to ever match`);
    assert.doesNotThrow(() => new URL(`https://${host}`), `${host} must be a valid host`);
  }
});

test("TOKENS fits its index width and every entry can pay for itself", () => {
  assert.ok(TOKENS.length <= 1 << TOKEN_INDEX_BITS,
    `${TOKENS.length} tokens do not fit ${TOKEN_INDEX_BITS} index bits`);
  assert.equal(new Set(TOKENS).size, TOKENS.length, "duplicate tokens waste slots");
  for (const token of TOKENS) {
    assert.ok(token.length >= 3, `"${token}" is too short to ever pay for its reference`);
    assert.ok([...token].every((c) => c.charCodeAt(0) < 128),
      `"${token}" must be ASCII to match on bytes`);
  }
});

test("the text code is a valid canonical Huffman table", () => {
  assert.equal(CODE_LENGTHS.length, 259, "256 bytes + TOKEN + END + ESC");
  // Kraft inequality: the lengths must describe a real prefix code.
  let kraft = 0;
  for (const length of CODE_LENGTHS) {
    assert.ok(length >= 0 && length <= 15, `code length ${length} out of range`);
    if (length) kraft += 2 ** -length;
  }
  assert.ok(kraft <= 1 + 1e-9, `Kraft sum ${kraft} > 1: not decodable`);
  // The controls must always be codable.
  for (const symbol of [SYM_TOKEN, SYM_END, SYM_ESC]) {
    assert.ok(CODE_LENGTHS[symbol] > 0, `control symbol ${symbol} has no code`);
  }
});

test("TEMPLATES fits its 8-bit index and slots agree with their patterns", () => {
  assert.ok(TEMPLATES.length <= 256, "the template index is 8 bits");
  for (const { pattern, slots } of TEMPLATES) {
    const holes = [...pattern.matchAll(/\{(\d)\}/g)].map((m) => Number(m[1]));
    assert.equal(holes.length, slots.length, `${pattern}: slot count`);
    assert.deepEqual(holes, holes.map((_, n) => n), `${pattern}: slots must be in order`);
    for (const slot of slots) {
      assert.ok(slot === "text" || CHARSETS[slot], `${pattern}: unknown charset "${slot}"`);
    }
    assert.ok(pattern.startsWith("https://"), `${pattern}: must be absolute https`);
  }
});

test("charsets are consistent with the widths they claim", () => {
  for (const [name, set] of Object.entries(CHARSETS)) {
    assert.ok(set.chars.length <= 1 << set.bits,
      `${name}: ${set.chars.length} characters do not fit in ${set.bits} bits`);
    assert.equal(new Set(set.chars).size, set.chars.length, `${name}: duplicate characters`);
  }
});

test("the scheme table fits its nibble and keeps its pinned values", () => {
  assert.ok(ENCODABLE_ORDER.length <= 15,
    "index is 4 bits and 15 is reserved for scheme-in-body");
  assert.equal(new Set(ENCODABLE_ORDER).size, ENCODABLE_ORDER.length);
  // The header's own scheme codes mirror these two positions; moving them
  // would repoint every http and https link at once.
  assert.equal(ENCODABLE_ORDER[0], "http:");
  assert.equal(ENCODABLE_ORDER[1], "https:");
  assert.equal(SCHEME_IN_BODY, 15);
  for (const scheme of ENCODABLE_ORDER) {
    assert.match(scheme, /^[a-z][a-z0-9+.-]*:$/, `${scheme} must be a scheme with colon`);
  }
  // Derived sets stay consistent with the table.
  assert.deepEqual([...ENCODABLE].sort(), [...ENCODABLE_ORDER].sort());
  for (const scheme of FOLLOWABLE) assert.ok(ENCODABLE.has(scheme));
});
