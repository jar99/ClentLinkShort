/**
 * The compatibility contract: a link, once made, decodes forever.
 *
 * BETA: while the beta runs, re-mining may replace the Huffman tables for
 * compression — when it does, regenerate the pins below deliberately, in
 * the same commit, knowing it invalidates earlier links. Declaring 1.0
 * means this file stops being regenerated: from then on the Huffman tables
 * never change, the indexed tables only grow past the pinned prefixes, and
 * future formats get the VERSION_ESCAPE envelope instead.
 *
 * The golden payloads below were produced by the v1 encoder and committed
 * as literals. They are the actual promise: whatever else changes, these
 * decode to exactly these destinations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  expand, VERSION, VERSION_ESCAPE, BitWriter, ClentError,
} from "../src/clent.js";
import { CODE_LENGTHS, TOKENS } from "../src/textcode.js";
import { HOST_CODE_LENGTHS, SUFFIXES } from "../src/hostcode.js";
import { HOSTS } from "../src/hosts.js";
import { TEMPLATES } from "../src/templates.js";
import { ENCODABLE_ORDER } from "../src/schemes.js";

const GOLDEN = [
  ["wHQEIvGrA", "https://example.com/"],
  ["IABdTkSjtChe4-NiMw", "https://github.com/anthropics/claude-code"],
  ["wVIDmoaiJ5lckai4z0RahQS0mDjHijMvAUfRmszM",
    "https://some-unseen-shop.com/products/blue-widget?size=m"],
  ["DAC3UMOMPVoF3EA", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["DJC0zq9Vb44uowAjY", "https://www.youtube.com/watch?v=TOr1Vvji6jA&t=36s"],
  ["DHbXOk0NKTzxs", "https://en.wikipedia.org/wiki/Alan_Turing"],
  ["wt4liz6ukeeF8Ahtjrhk8Ghg", "https://blog.startup.io/posts/2026-hello"],
  ["xR7cylMdgXwBwOAqjY", "http://old-site.net/index.php?id=42"],
  ["CJXfe1e4DY5ZvQWoUTYCqYPMbO4H7CuQyTM",
    "mailto:someone@example.com?subject=Hi%20there"],
  ["wHQEIvHeCKKAUOButlfi_IbiSxs", "https://example.co.uk/a/b/c?q=test#frag"],
  ["CEQu9pzFGN7gNjlm9BahRML1pJls", "https://user:pw@example.com/secret"],
  ["wHQEIvGoqZzw9nEDCbBg2gYTYMFsGE4B4YMJsGC2DCbBg4IMJsGDhgwmwYLuButmEtwFt0Fp9g",
    "https://example.com/unicode/%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3?q=caf%C3%A9"],
  ["gS61IzC3ISdVLzs_VT0xKTklNS88YZdCWAQA",
    "https://example.com/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/"],
  ["DIiDkAAAA", "https://news.ycombinator.com/item?id=39000000"],
];

test("golden payloads decode to their destinations, forever", async () => {
  for (const [payload, href] of GOLDEN) {
    assert.equal((await expand(payload)).href, href, payload);
  }
});

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

test("the frozen tables are byte-for-byte what v1 shipped", () => {
  // These four never change at all: every entry participates in a canonical
  // Huffman code, so any edit re-maps codes and repoints existing links.
  assert.equal(hash([...CODE_LENGTHS]), "d458308ba0c7a36a", "CODE_LENGTHS changed");
  assert.equal(hash([...TOKENS]), "1e7ac40aeb4166a6", "TOKENS changed");
  assert.equal(hash([...HOST_CODE_LENGTHS]), "5a2f983435a10fe7", "HOST_CODE_LENGTHS changed");
  assert.equal(hash([...SUFFIXES]), "4539d5038517ee11", "SUFFIXES changed");
});

test("the indexed tables only ever grow", () => {
  // Position IS the wire encoding, so the shipped prefix must survive any
  // append. Appending new entries is fine — extend the pin when you do.
  assert.ok(HOSTS.length >= 253);
  assert.equal(hash(HOSTS.slice(0, 253)), "2940b57ecb175911", "HOSTS prefix changed");
  assert.ok(TEMPLATES.length >= 90);
  assert.equal(hash(TEMPLATES.slice(0, 90).map((t) => [t.pattern, ...t.slots])),
    "d2c8c41958415425", "TEMPLATES prefix changed");
  assert.ok(ENCODABLE_ORDER.length >= 13);
  assert.equal(hash(ENCODABLE_ORDER.slice(0, 13)), "b1811f4d592941c5",
    "ENCODABLE_ORDER prefix changed");
});

test("the wire version is 1 and stays 1", () => {
  // A different number here means the freeze was broken. New formats ride
  // the version envelope; they do not renumber this one.
  assert.equal(VERSION, 1);
});

test("a future-version envelope fails with the right message, not a misread", async () => {
  const w = new BitWriter();
  w.push(VERSION_ESCAPE, 6);
  w.push(3, 4); // hypothetical wire v-next
  w.push(0b10101010, 8); // arbitrary trailing content
  await assert.rejects(() => expand(w.finish()), (error) => {
    assert.ok(error instanceof ClentError);
    assert.match(error.message, /newer version/);
    return true;
  });
});
