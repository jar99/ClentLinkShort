/**
 * URL templates.
 *
 * The risk with templates is not that they fail to match — it is that they
 * match *loosely*, capture something slightly different from what was there,
 * and rebuild a URL that points somewhere else. Every test here is really
 * about that.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { shorten, expand, analyze, parse, TEMPLATES } from "../src/clent.js";
import { CHARSETS, COMPILED, MAX_SLOT, fill } from "../src/templates.js";

const TEMPLATED = [
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.youtube.com/shorts/aB3-_xYz012",
  "https://x.com/someuser/status/1234567890123456789",
  "https://twitter.com/a_user.name/status/9",
  "https://www.facebook.com/somepage/posts/1029384756",
  "https://www.instagram.com/p/CabcDefGhij/",
  "https://www.reddit.com/r/programming/comments/1abc2de/",
  "https://old.reddit.com/r/all/comments/xyz123/",
  "https://www.tiktok.com/@someone/video/7123456789012345678",
  "https://i.imgur.com/aB3dEfG.jpg",
  "https://i.imgur.com/aB3dEfG.png",
  "https://imgur.com/a/AbCdEfG",
  "https://i.redd.it/abc123def.jpg",
  "https://pbs.twimg.com/media/AbC-dEf.jpg",
  "https://www.amazon.com/dp/B08N5WRWNW",
  "https://www.amazon.co.uk/dp/B01ABCDEFG",
  "https://www.amazon.com/gp/product/B00TEST123",
  "https://www.ebay.com/itm/123456789012",
  "https://www.etsy.com/listing/1234567/handmade-thing",
  "https://github.com/anthropics/claude-code",
  "https://github.com/nodejs/node/issues/12345",
  "https://github.com/nodejs/node/pull/9",
  "https://en.wikipedia.org/wiki/uniform_resource_locator",
  "https://arxiv.org/abs/2401.12345",
  "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  "https://news.ycombinator.com/item?id=38765432",
  "https://stackoverflow.com/questions/12345/how-do-i-do-a-thing",
  "https://bsky.app/profile/someone.bsky.social/post/3kabcdefg",
  "https://www.linkedin.com/posts/some-slug-1234",
];

test("templated URLs round-trip exactly", async () => {
  for (const url of TEMPLATED) {
    const back = await expand(await shorten(url, { stripTracking: false }));
    assert.equal(back.href, parse(url).href, url);
  }
});

test("a template is only used when it actually wins", async () => {
  let used = 0;
  for (const url of TEMPLATED) {
    const a = await analyze(url, { stripTracking: false });
    if (a.template !== null) {
      used++;
      assert.ok(a.payload.length <= a.candidates.text,
        `${url}: template ${a.payload.length} should beat text ${a.candidates.text}`);
    }
  }
  assert.ok(used > TEMPLATED.length * 0.7,
    `expected most of these to template, got ${used}/${TEMPLATED.length}`);
});

test("templates make the links they target much shorter", async () => {
  // The whole point. If these regress, the templates are costing complexity
  // for nothing.
  const targets = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", 18],
    ["https://www.amazon.com/dp/B08N5WRWNW", 16],
    ["https://i.imgur.com/aB3dEfG.jpg", 14],
    ["https://www.instagram.com/p/CabcDefGhij/", 18],
  ];
  for (const [url, budget] of targets) {
    const payload = await shorten(url, { stripTracking: false });
    assert.ok(payload.length <= budget,
      `${url} encoded to ${payload.length} chars, expected <= ${budget}`);
  }
});

test("a near-miss never silently resolves to a different URL", async () => {
  // Each of these looks like a templated URL but is not one. If a template
  // matched loosely, the round-trip would come back subtly wrong rather than
  // failing, so equality here is the whole assertion.
  for (const url of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42",   // extra parameter
    "https://www.youtube.com/watch?v=short",              // wrong ID length is fine, but must survive
    "https://youtu.be/dQw4w9WgXcQ?t=1",
    "https://www.amazon.com/dp/b08n5wrwnw",               // lowercase, wrong charset
    "https://www.amazon.com/dp/B08N5WRWNW/",              // trailing slash
    "https://github.com/anthropics/claude-code/",
    "https://github.com/anthropics/claude-code/tree/main",
    "https://en.wikipedia.org/wiki/Caf%C3%A9",            // percent-encoded
    "https://x.com/user/status/12345?s=20",
    "https://www.reddit.com/r/x/comments/y/z/",
    "https://i.imgur.com/abc.jpeg",                        // .jpeg, not .jpg
  ]) {
    const back = await expand(await shorten(url, { stripTracking: false }));
    assert.equal(back.href, parse(url).href, url);
  }
});

test("filling a template is the exact inverse of matching it", () => {
  for (let i = 0; i < COMPILED.length; i++) {
    const template = COMPILED[i];
    // Build a value for each slot from its own alphabet, then check the
    // rebuilt URL matches its own pattern again.
    const values = template.slots.map((name) =>
      name === "text" ? "SomeMixed_Title" : CHARSETS[name].chars.slice(1, 6));
    const built = fill(i, values);
    const found = template.match.exec(built);
    assert.ok(found, `${template.pattern} did not match its own output ${built}`);
    assert.deepEqual(found.slice(1), values, template.pattern);
  }
});

test("a slot longer than the length field can hold is refused", async () => {
  const long = "a".repeat(MAX_SLOT + 5);
  const url = `https://en.wikipedia.org/wiki/${long}`;
  const a = await analyze(url, { stripTracking: false });
  assert.equal(a.template, null, "an over-long slot must fall back, not truncate");
  assert.equal((await expand(a.payload)).href, parse(url).href);
});

test("a template index beyond the table is rejected, not guessed", async () => {
  const { BitWriter, SCHEME_TEMPLATE, HEADER_CODE_LENGTHS } = await import("../src/clent.js");
  const { buildCode, pushCode } = await import("../src/huffman.js");
  const { writeIndex } = await import("../src/bits.js");
  const w = new BitWriter();
  pushCode(w, buildCode(HEADER_CODE_LENGTHS), SCHEME_TEMPLATE);
  writeIndex(w, 900);    // no such template
  w.push(3, 6);
  for (let i = 0; i < 3; i++) w.push(1, 6);
  await assert.rejects(() => expand(w.finish()), /newer template|damaged|truncated/);
});
