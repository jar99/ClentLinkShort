/**
 * The compatibility contract: a link, once made, decodes forever.
 *
 * FROZEN AT 1.0. This file is not regenerated any more. The beta spent its
 * licence to re-mine: the tables below are the ones that ship forever, the
 * indexed tables may only grow past the pinned prefixes, and a future format
 * gets the VERSION_ESCAPE envelope rather than a renumbering.
 *
 * So a failure here is not a pin to refresh. It means a change would break
 * links that already exist, and the change is what has to give.
 *
 * The golden payloads below were produced by the v1 encoder and committed
 * as literals. They are the actual promise: whatever else changes, these
 * decode to exactly these destinations.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  expand, VERSION, VERSION_ESCAPE, BitWriter, ClentError, HEADER_CODE_LENGTHS,
} from "../src/clent.js";
import { CODE_LENGTHS, TOKENS } from "../src/textcode.js";
import { HOST_CODE_LENGTHS, SUFFIXES } from "../src/hostcode.js";
import { HOSTS } from "../src/hosts.js";
import { TEMPLATES } from "../src/templates.js";
import { ENCODABLE_ORDER } from "../src/schemes.js";

const GOLDEN = [
  ["B2wjKA2W", "https://example.com/"],
  ["ZB6jCg8nq4XzDlgJvkBFg", "https://github.com/anthropics/claude-code"],
  ["GSI6qGwiepsklbZ_VPMvGlIC4WCyRWeSXJJUiW",
    "https://some-unseen-shop.com/products/blue-widget?size=m"],
  ["WLdQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  ["XYC0zq9Vb44uowAkg", "https://www.youtube.com/watch?v=TOr1Vvji6jA&t=36s"],
  ["XBqphxixZUZSw", "https://en.wikipedia.org/wiki/Alan_Turing"],
  ["O0486S7LnSctqkCHrp1g", "https://blog.startup.io/posts/2026-hello"],
  ["hIP1MUx3fOec8PQaW", "http://old-site.net/index.php?id=42"],
  ["v8JPj-q7CTIHFIYk988WeTK9jkfVUz5ZzTGYgiw",
    "mailto:someone@example.com?subject=Hi%20there"],
  ["B2wjKA9iEYXgv57VVFcFzKwgdlY", "https://example.co.uk/a/b/c?q=test#frag"],
  ["v8EIZfDZ2S5sJMgcUhiT3zxBSR9BFL", "https://user:pw@example.com/secret"],
  ["B2wjKA2DLGV_toZ14xOrVZ14xOrMTrxmc41OvGJ1ZideMTq1adeMTq17OvGJ1ZvPaqo-OxOrtzqrqw",
    "https://example.com/unicode/%D0%BA%D0%B0%D1%82%D0%B0%D0%BB%D0%BE%D0%B3?q=caf%C3%A9"],
  ["wTS61IzC3ISdVLzs_VT0xKTklNS88YZdCWAQA",
    "https://example.com/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/abcdefgh/"],
  ["XSSEpi-A", "https://news.ycombinator.com/item?id=39000000"],
];

test("golden payloads decode to their destinations, forever", async () => {
  for (const [payload, href] of GOLDEN) {
    assert.equal((await expand(payload)).href, href, payload);
  }
});

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

test("the frozen tables are byte-for-byte what v1 shipped", () => {
  // These never change at all: every entry participates in a canonical
  // Huffman code, so any edit re-maps codes and repoints existing links.
  //
  // The header code belongs here most of all — every payload begins with one
  // of its symbols, so a single changed length repoints every link ever made,
  // including the ones that use none of the tables below. It went unpinned
  // through the whole beta; declaring 1.0 is the moment to fix that.
  assert.equal(hash([...HEADER_CODE_LENGTHS]), "d70134660e74f8f6",
    "HEADER_CODE_LENGTHS changed");
  assert.equal(hash([...CODE_LENGTHS]), "6f65aea38c9890b5", "CODE_LENGTHS changed");
  assert.equal(hash([...TOKENS]), "75d125d5afd15e22", "TOKENS changed");
  assert.equal(hash([...HOST_CODE_LENGTHS]), "0cd172fdf782cbd5", "HOST_CODE_LENGTHS changed");
  assert.equal(hash([...SUFFIXES]), "1b9bfe83f3a6b2a4", "SUFFIXES changed");
});

test("the indexed tables only ever grow", () => {
  // Position IS the wire encoding, so the shipped prefix must survive any
  // append. Appending new entries is fine — extend the pin when you do.
  assert.ok(HOSTS.length >= 512);
  assert.equal(hash(HOSTS.slice(0, 512)), "e1fa941060b21162", "HOSTS prefix changed");
  assert.ok(TEMPLATES.length >= 258);
  assert.equal(hash(TEMPLATES.slice(0, 258).map((t) => [t.pattern, ...t.slots])),
    "8a9c14be6ca3744e", "TEMPLATES prefix changed");
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
  const { HEADER_CODE_LENGTHS } = await import("../src/clent.js");
  const { buildCode, pushCode } = await import("../src/huffman.js");
  const w = new BitWriter();
  pushCode(w, buildCode(HEADER_CODE_LENGTHS), VERSION_ESCAPE);
  w.push(3, 4); // hypothetical wire v-next
  w.push(0b10101010, 8); // arbitrary trailing content
  await assert.rejects(() => expand(w.finish()), (error) => {
    assert.ok(error instanceof ClentError);
    assert.match(error.message, /newer version/);
    return true;
  });
});
