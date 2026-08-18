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

test("the README mode shares match the measured stats", { skip }, async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const stats = JSON.parse(await readFile(statsFile, "utf8"));
  assert.ok(stats.modes, "stats.json should carry per-mode counts");

  // Quoted twice (the validation table and the encoding walkthrough); both
  // must carry the measured share for the modes big enough to round to a
  // tenth of a percent.
  for (const [name, count] of Object.entries(stats.modes)) {
    const pct = (100 * count) / stats.checked;
    if (pct < 0.1) continue;
    const quoted = readme.match(new RegExp(`${name}(?: wins)? ([\\d.]+)%`));
    assert.ok(quoted, `README should quote the "${name}" mode share`);
    assert.equal(Number(quoted[1]).toFixed(1), pct.toFixed(1),
      `README says ${quoted[1]}% for "${name}"; stats.json says ${pct.toFixed(1)}%`);
  }
});

test("the README lists every test file", async () => {
  // The layout block drifted to "134 tests" and three missing suites before
  // anyone noticed, because nothing checked it. Names are cheap to verify
  // even though the count is not, so at least the listing stays honest.
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const { readdirSync } = await import("node:fs");
  const suites = readdirSync(path.join(ROOT, "test"))
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => file.replace(/\.test\.js$/, ""));
  const block = readme.match(/^test\/ +\d+ tests on node:test\n([\s\S]*?)\n\n/m);
  assert.ok(block, "the README should carry the test layout block");
  for (const suite of suites) {
    assert.match(block[1], new RegExp(`^ {2}${suite}\\b`, "m"),
      `README's test listing is missing "${suite}"`);
  }
});

test("the README template count matches the shipped table", async () => {
  const readme = await readFile(path.join(ROOT, "README.md"), "utf8");
  const { TEMPLATES } = await import("../src/templates.js");
  const quoted = readme.match(/(\d+) templates cover/);
  assert.ok(quoted, "README should quote the template count");
  assert.equal(Number(quoted[1]), TEMPLATES.length,
    `README says ${quoted[1]} templates; the table ships ${TEMPLATES.length}`);
});
