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
import { TOKENS, CODE_LENGTHS, TOKEN_BASE, SYM_END, SYM_ESC } from "../src/textcode.js";
import { TEMPLATES, CHARSETS } from "../src/templates.js";
import { ENCODABLE_ORDER, SCHEME_IN_BODY, ENCODABLE, FOLLOWABLE } from "../src/schemes.js";

test("HOSTS entries are unique and every one is usable", () => {
  // The escape-coded index is open-ended; there is no size cap any more.
  assert.equal(new Set(HOSTS).size, HOSTS.length, "duplicate entries waste indices");
  for (const host of HOSTS) {
    assert.equal(host, host.toLowerCase(), `${host} must be lowercase to ever match`);
    assert.doesNotThrow(() => new URL(`https://${host}`), `${host} must be a valid host`);
  }
});

test("TOKENS line up with their symbols and every entry can pay for itself", () => {
  assert.equal(CODE_LENGTHS.length, TOKEN_BASE + TOKENS.length,
    "one code length per byte, control and token symbol");
  assert.equal(new Set(TOKENS).size, TOKENS.length, "duplicate tokens waste slots");
  for (const token of TOKENS) {
    assert.ok(token.length >= 3, `"${token}" is too short to ever pay for its reference`);
    assert.ok([...token].every((c) => c.charCodeAt(0) < 128),
      `"${token}" must be ASCII to match on bytes`);
  }
});

test("the text code is a valid canonical Huffman table", () => {
  // Kraft inequality: the lengths must describe a real prefix code.
  let kraft = 0;
  for (const length of CODE_LENGTHS) {
    assert.ok(length >= 0 && length <= 15, `code length ${length} out of range`);
    if (length) kraft += 2 ** -length;
  }
  assert.ok(kraft <= 1 + 1e-9, `Kraft sum ${kraft} > 1: not decodable`);
  // The controls must always be codable.
  for (const symbol of [SYM_END, SYM_ESC]) {
    assert.ok(CODE_LENGTHS[symbol] > 0, `control symbol ${symbol} has no code`);
  }
});

test("TEMPLATES slots agree with their patterns", () => {
  // No size cap: the index escapes past 255 by chaining, so the table can
  // grow forever without a format change.
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

test("a slot inside the host can never reach past the host", () => {
  // Wildcard-host templates ("https://{0}.fandom.com/...") put attacker
  // controlled bytes into the authority. A decoded payload never goes through
  // asTemplate's reproduce-exactly guard — it is fed straight to fill() — so
  // the only thing standing between a slot value and a different site is the
  // slot's alphabet. A charset containing "/", "@" or ":" would let slot 0 of
  // "https://{0}.fandom.com/wiki/{1}" be "evil.com/", making the host
  // evil.com: still https, so finish() would happily allow it.
  //
  // Every host slot uses a charset today; "text" accepts anything and must
  // never appear in one. This is the check that keeps the next appended
  // template honest.
  const ESCAPES = ["/", "@", ":", "?", "#", "\\"];
  for (const { pattern, slots } of TEMPLATES) {
    const authority = pattern.slice("https://".length).split("/")[0];
    for (const [n, slot] of slots.entries()) {
      if (!authority.includes(`{${n}}`)) continue;
      assert.notEqual(slot, "text",
        `${pattern}: slot ${n} is in the host, so it cannot use the unrestricted "text" charset`);
      const charset = CHARSETS[slot];
      assert.ok(charset, `${pattern}: slot ${n} uses unknown charset "${slot}"`);
      for (const character of ESCAPES) {
        assert.ok(!charset.chars.includes(character),
          `${pattern}: slot ${n} is in the host and its "${slot}" charset contains ` +
          `"${character}", which can escape the host label`);
      }
    }
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
