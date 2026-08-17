/**
 * The QR encoder against independent ground truth.
 *
 * test/qr-fixtures.json holds matrices produced by the python "qrcode"
 * library (an ISO 18004 implementation) for a spread of payloads crossing
 * every supported version boundary, generated at the mask src/qr.js selects
 * and spot-decoded with OpenCV's QRCodeDetector at generation time. A QR
 * that is subtly wrong still *looks* like a QR, so structural checks alone
 * prove nothing — byte-for-byte equality with a second implementation does.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { qrMatrix, qrCapacity } from "../src/qr.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Unpack a base64 bit string back into 0/1 per module. */
function unpack(b64, count) {
  const bytes = Buffer.from(b64, "base64");
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  }
  return out;
}

test("matrices match the reference implementation byte for byte", async () => {
  const { fixtures } = JSON.parse(
    await readFile(path.join(HERE, "qr-fixtures.json"), "utf8"));
  assert.ok(fixtures.length >= 15, "the fixture set should cover the versions");

  for (const fixture of fixtures) {
    const result = qrMatrix(fixture.text);
    assert.ok(result, `no matrix for ${JSON.stringify(fixture.text.slice(0, 30))}`);
    assert.equal(result.size, fixture.size, fixture.text.slice(0, 40));
    const expected = unpack(fixture.modules, fixture.size * fixture.size);
    assert.deepEqual(result.modules, expected,
      `matrix differs for length ${fixture.text.length} (v${(fixture.size - 17) / 4})`);
  }
});

test("capacity edges are exact", () => {
  // One byte over a version's capacity must move up a version; one byte
  // over the last version's must return null rather than a corrupt matrix.
  for (let version = 1; version < 11; version++) {
    const fits = qrMatrix("x".repeat(qrCapacity(version)));
    const spills = qrMatrix("x".repeat(qrCapacity(version) + 1));
    assert.equal(fits.size, 17 + 4 * version, `version ${version} underfilled`);
    assert.ok(spills.size > fits.size, `version ${version} overfilled`);
  }
  assert.equal(qrMatrix("x".repeat(qrCapacity(11))).size, 17 + 4 * 11);
  assert.equal(qrMatrix("x".repeat(qrCapacity(11) + 1)), null);
});

test("multi-byte input is measured in bytes, not characters", () => {
  // 42 characters of 3-byte UTF-8 is 126 bytes: past v5's 84, into v7.
  const text = "あ".repeat(42);
  const m = qrMatrix(text);
  assert.ok(m && m.size >= 17 + 4 * 7, `got size ${m?.size}`);
});

test("every matrix carries the fixed structure a scanner locks onto", () => {
  for (const text of ["https://nul.im/#abc", "x".repeat(200)]) {
    const { size, modules } = qrMatrix(text);
    const at = (x, y) => modules[y * size + x];
    // Finder centres are dark, their rings alternate.
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      assert.equal(at(cx, cy), 1);
      assert.equal(at(cx - 1, cy), 1);
      assert.equal(at(cx - 2, cy), 0);
      assert.equal(at(cx - 3, cy), 1);
    }
    // Timing patterns alternate along row/column 6.
    for (let i = 8; i < size - 8; i++) {
      assert.equal(at(i, 6), i % 2 === 0 ? 1 : 0, `timing row at ${i}`);
      assert.equal(at(6, i), i % 2 === 0 ? 1 : 0, `timing column at ${i}`);
    }
    // The always-dark module.
    assert.equal(at(8, size - 8), 1);
  }
});
