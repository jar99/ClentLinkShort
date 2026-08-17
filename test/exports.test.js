/**
 * Export parity: the hand-written .d.ts files against the live modules.
 *
 * This is exactly the drift class that happened before — the runtime grew
 * assess(), TEMPLATES and template fields while the .d.ts still described a
 * version two formats back. tsc in CI catches type errors; this dependency-
 * free check catches a value export existing on one side and not the other,
 * in either direction, on every `npm test`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MODULES = [
  "clent", "bits", "deflate", "text6", "tracking", "risk",
  "hosts", "tokens", "schemes", "templates", "sign",
];

/**
 * Value exports declared by a .d.ts: `export declare const|function|class NAME`
 * and re-export lists `export { A, B } from "./x.js"`. Interfaces and type
 * aliases are type-only and excluded on purpose.
 */
function declaredExports(source) {
  const names = new Set();
  for (const match of source.matchAll(
    /^export declare (?:const|let|function|class) ([A-Za-z_$][\w$]*)/gm)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export declare const ([A-Za-z_$][\w$]*):/gm)) {
    names.add(match[1]);
  }
  for (const match of source.matchAll(/^export \{([^}]+)\}/gm)) {
    for (const piece of match[1].split(",")) {
      const name = piece.split(" as ").pop().trim();
      if (name) names.add(name);
    }
  }
  // `export declare const join: (...)` style arrow declarations
  for (const match of source.matchAll(/^export declare const ([A-Za-z_$][\w$]*)\b/gm)) {
    names.add(match[1]);
  }
  return names;
}

for (const name of MODULES) {
  test(`src/${name}.d.ts matches src/${name}.js exactly`, async () => {
    const runtime = new Set(Object.keys(await import(`../src/${name}.js`)));
    const declared = declaredExports(
      await readFile(path.join(ROOT, "src", `${name}.d.ts`), "utf8"));

    const undeclared = [...runtime].filter((n) => !declared.has(n));
    const phantom = [...declared].filter((n) => !runtime.has(n));

    assert.deepEqual(undeclared, [],
      `exported by ${name}.js but missing from ${name}.d.ts`);
    assert.deepEqual(phantom, [],
      `declared in ${name}.d.ts but not exported by ${name}.js`);
  });
}
