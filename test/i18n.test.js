/**
 * The translation layer, and the one invariant that keeps it honest: every
 * catalogue answers for the same keys, and every key the code asks for exists.
 *
 * A missing key is not a crash — t() falls back to English and then to the key
 * itself — which is exactly why it needs a test. A silent fallback is a hole
 * you find in production, in the language you do not read.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOGUES, choose, has, setLanguage, t, language } from "../src/i18n.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

test.afterEach(() => setLanguage("en"));

test("English is the reference, and every catalogue answers for its keys", () => {
  const reference = Object.keys(CATALOGUES.en);
  assert.ok(reference.length > 40, "English catalogue looks truncated");
  for (const [code, messages] of Object.entries(CATALOGUES)) {
    const missing = reference.filter((key) => !Object.hasOwn(messages, key));
    const extra = Object.keys(messages).filter((key) => !reference.includes(key));
    assert.deepEqual(missing, [], `${code} is missing keys`);
    assert.deepEqual(extra, [], `${code} has keys English does not`);
  }
});

test("every catalogue file is registered, so a translation cannot go unshipped", () => {
  const files = readdirSync(path.join(ROOT, "src", "messages"))
    .filter((name) => name.endsWith(".js"))
    .map((name) => name.replace(/\.js$/, ""));
  assert.deepEqual(files.sort(), Object.keys(CATALOGUES).sort());
});

test("placeholders survive translation", () => {
  // A translator can reorder a sentence but cannot drop the value it carries.
  const withValues = {
    "r.externalApp": ["scheme"],
    "risk.userinfo": ["host"],
    "risk.impersonation": ["brand", "host"],
    "risk.port": ["port"],
    "m.shorter": ["saved"],
    "m.shorterCleaned": ["saved", "removed"],
    "m.longer": ["longer"],
    "m.willWarn": ["reasons"],
    "m.veryLong": ["length"],
  };
  for (const [code, messages] of Object.entries(CATALOGUES)) {
    for (const [key, names] of Object.entries(withValues)) {
      for (const name of names) {
        assert.ok(messages[key].includes(`{${name}}`),
          `${code}: ${key} lost the {${name}} placeholder`);
      }
    }
  }
});

test("t() fills placeholders and leaves unknown ones alone", () => {
  setLanguage("en");
  assert.match(t("risk.port", { port: "8443" }), /8443/);
  assert.match(t("risk.port", {}), /\{port\}/);
});

test("a key no catalogue has comes back as itself, not as empty text", () => {
  assert.equal(t("no.such.key"), "no.such.key");
  assert.equal(has("no.such.key"), false);
  assert.equal(has("r.continue"), true);
});

test("choose() prefers an exact match, then the base language, then English", () => {
  assert.equal(choose(["es"]), "es");
  assert.equal(choose(["es-MX", "en"]), "es");
  assert.equal(choose(["fr-CA", "es-AR"]), "es");
  assert.equal(choose(["fr", "de"]), "en");
  assert.equal(choose([]), "en");
  assert.equal(choose(), "en");
});

test("an unknown language falls back rather than emptying the page", () => {
  assert.equal(setLanguage("xx"), "en");
  assert.equal(language(), "en");
});

test("a translated page still says the same thing where it matters", () => {
  setLanguage("es");
  assert.equal(t("r.continue"), "Continuar");
  // A key Spanish does not have would come back in English, not blank.
  assert.equal(t("lang.name"), "Español");
});

test("every key the code asks for exists in English", () => {
  // t("...") and data-t="..." are the two ways a key enters the app. Both are
  // greppable, so an unresolvable key is a test failure rather than a blank
  // element someone notices later.
  const sources = ["src/app.js", "src/index.html"];
  const keys = new Set();
  for (const file of sources) {
    const text = read(file);
    for (const [, key] of text.matchAll(/\bt\(\s*"([\w.-]+)"/g)) keys.add(key);
    for (const [, key] of text.matchAll(/data-t="([\w.-]+)"/g)) keys.add(key);
    for (const [, pairs] of text.matchAll(/data-t-attr="([^"]+)"/g)) {
      for (const pair of pairs.split(",")) keys.add(pair.split(":")[1].trim());
    }
  }
  assert.ok(keys.size > 20, `only found ${keys.size} keys; the scan is broken`);
  for (const key of keys) {
    assert.ok(Object.hasOwn(CATALOGUES.en, key), `no English message for "${key}"`);
  }
});

test("every risk code the assessor can emit is translatable", () => {
  // risk.js carries its own English, so a missing catalogue entry degrades
  // silently to that. This is the check that stops it going unnoticed.
  const codes = [...read("src/risk.js").matchAll(/add\(\s*"([\w-]+)"/g)]
    .map(([, code]) => code);
  assert.ok(codes.length >= 6, `found only ${codes.length} risk codes`);
  for (const code of codes) {
    assert.ok(Object.hasOwn(CATALOGUES.en, `risk.${code}`),
      `no message for risk code "${code}"`);
  }
});

test("the stylesheet is direction-independent, so an RTL catalogue would lay out", () => {
  // Logical properties are what make dir="rtl" more than an attribute. The one
  // exception is deliberate: a notch is on a physical side of the device and
  // does not move when the text direction does.
  const css = read("src/style.css");
  const physical = [...css.matchAll(
    /^\s*(?:[\w.#:>\-\[\]="' ]+\{\s*)?((?:margin|padding|border|inset)-(?:left|right)|left|right|float|clear)\s*:\s*([^;]+);/gm)]
    .map(([whole, property, value]) => `${property}: ${value.trim()}`)
    .filter((rule) => !rule.includes("safe-area-inset"));
  assert.deepEqual(physical, [],
    "use the logical property (inline-start/inline-end) instead");

  const aligned = [...css.matchAll(/text-align:\s*(left|right)\b/g)];
  assert.deepEqual(aligned.map(([whole]) => whole), [],
    "use text-align: start / end instead");
});

test("a catalogue can only set attributes it has no way to abuse", async () => {
  // data-t-attr turns a catalogue value into a DOM attribute. The attribute
  // name comes from our markup and the value from a translation, which is data
  // someone else contributes -- so "href:some.key" would let a catalogue supply
  // a javascript: URL. Adding a language is meant to be a file and a line;
  // this is what makes accepting that file safe.
  const { translate, setLanguage } = await import("../src/i18n.js");
  const seen = [];
  const element = {
    dataset: { tAttr: "placeholder:r.passphrase,href:r.continue,onclick:r.continue" },
    setAttribute: (name, value) => seen.push([name, value]),
  };
  const root = {
    querySelectorAll: (selector) =>
      selector === "[data-t-attr]" ? [element] : [],
  };
  setLanguage("en");
  translate(/** @type {any} */ (root));
  assert.deepEqual(seen.map(([name]) => name), ["placeholder"],
    "only allowlisted attributes may come from a catalogue");
});

test("a key that is only on Object.prototype is not a message", () => {
  // t() used plain property access, so "toString" resolved to a function and
  // format() then called .replace on it -- a TypeError thrown midway through a
  // DOM walk, leaving the page half translated. has() beside it already used
  // Object.hasOwn; these two have to agree.
  for (const key of ["toString", "constructor", "__proto__", "valueOf"]) {
    assert.equal(t(key), key, `${key} must fall through to the key itself`);
    assert.equal(has(key), false, `${key} is not a message`);
  }
});
