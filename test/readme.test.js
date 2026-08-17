/**
 * The README quotes measured numbers. The build substitutes the page's copies
 * from corpus/stats.json, but the README is prose in git — so this pins the
 * quoted figures to the same file, and the wire-format heading to VERSION.
 * A codec change that shifts the numbers now fails here instead of leaving
 * stale claims in the front door of the repository.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION } from "../src/clent.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statsFile = path.join(ROOT, "corpus", "stats.json");
const skip = existsSync(statsFile) ? false : "no corpus stats";

test("the README wire-format heading matches VERSION", async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const heading = readme.match(/### Wire format v(\d+)/);
  assert.ok(heading, "the README should document the wire format");
  assert.equal(Number(heading[1]), VERSION,
    "the README documents a different wire version than the code ships");
});

test("the README break-even table matches the measured stats", { skip }, async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const stats = JSON.parse(await readFile(statsFile, "utf8"));

  for (const prefix of stats.prefixes) {
    if (!prefix.length) continue; // the payload-only row is not quoted by length
    const quoted = readme.match(
      new RegExp(`\\(${prefix.length}c\\) \\| ~(\\d+) \\| ([\\d.]+)% \\|`));
    assert.ok(quoted, `README should quote the ${prefix.length}c prefix row`);
    assert.equal(Number(quoted[2]).toFixed(1), prefix.shorterPct.toFixed(1),
      `README says ${quoted[2]}% for the ${prefix.length}c prefix; ` +
      `stats.json says ${prefix.shorterPct.toFixed(1)}%`);
  }
});
