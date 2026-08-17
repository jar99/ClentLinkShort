/**
 * A tiny bundler for this project's own module graph.
 *
 * It understands exactly one thing: static, relative, acyclic ES module
 * imports with no default exports. Everything else is a build error rather
 * than a silent mistake, because the failure mode of a too-clever bundler is a
 * site that only breaks in the browser.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const IMPORT = /^[ \t]*import\s+[\s\S]*?from\s*["'](\.[^"']+)["'];?[ \t]*$/gm;
const BARE_IMPORT = /^[ \t]*import\s*["'](\.[^"']+)["'];?[ \t]*$/gm;
const REEXPORT = /^[ \t]*export\s*\{[^}]*\}\s*(?:from\s*["'][^"']+["'])?\s*;?[ \t]*$/gm;
const EXPORT_DECL = /^([ \t]*)export\s+(?=(?:async\s+)?(?:const|let|var|function|class)\b)/gm;

/**
 * Resolve the graph from an entry module and return its sources in dependency
 * order, with import/export syntax removed so they concatenate into one
 * classic script.
 *
 * @param {string} entry absolute path of the entry module
 * @returns {Promise<{code: string, files: string[]}>}
 */
export async function bundle(entry) {
  /** @type {string[]} */ const order = [];
  /** @type {Map<string, string>} */ const sources = new Map();
  const visiting = new Set();

  async function visit(file) {
    if (sources.has(file)) return;
    if (visiting.has(file)) {
      throw new Error(`Import cycle through ${path.relative(ROOT, file)}`);
    }
    visiting.add(file);

    const source = await readFile(file, "utf8");
    const deps = [
      ...[...source.matchAll(IMPORT)].map((m) => m[1]),
      ...[...source.matchAll(BARE_IMPORT)].map((m) => m[1]),
    ];
    for (const spec of deps) await visit(path.resolve(path.dirname(file), spec));

    visiting.delete(file);
    sources.set(file, source);
    order.push(file);
  }

  await visit(entry);

  const chunks = order.map((file) => {
    const stripped = sources.get(file)
      .replace(IMPORT, "")
      .replace(BARE_IMPORT, "")
      .replace(REEXPORT, "")
      .replace(EXPORT_DECL, "$1");

    const leftover = stripped.match(/^[ \t]*(?:import|export)\b.*$/m);
    if (leftover) {
      throw new Error(
        `${path.relative(ROOT, file)}: unsupported module syntax\n  ${leftover[0].trim()}`);
    }
    return `/* ${path.relative(ROOT, file)} */\n${stripped}`;
  });

  assertNoCollisions(order, chunks);
  return { code: chunks.join("\n"), files: order };
}

/**
 * Top-level declarations, by name, per module.
 *
 * A heuristic, and deliberately a conservative one: it matches declarations
 * starting in column zero, which in this codebase means top level, because
 * everything nested is indented. It can miss a declaration it should catch;
 * it will not invent one that is not there.
 */
const TOP_LEVEL =
  /^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

/**
 * Refuse to emit a bundle whose modules would trip over each other.
 *
 * Concatenating modules puts every top-level name in one scope. Two modules
 * each declaring `const encoder` is perfectly legal as modules and a
 * SyntaxError as a bundle — and the failure appears in the browser, not here,
 * long after the build reported success. This turns that into a build error.
 *
 * @param {string[]} files
 * @param {string[]} chunks
 */
function assertNoCollisions(files, chunks) {
  /** @type {Map<string, string>} name -> the file that declared it first */
  const declared = new Map();
  const clashes = [];

  chunks.forEach((chunk, i) => {
    const file = path.relative(ROOT, files[i]);
    for (const [, name] of chunk.matchAll(TOP_LEVEL)) {
      const previous = declared.get(name);
      if (previous && previous !== file) clashes.push({ name, previous, file });
      else declared.set(name, file);
    }
  });

  if (clashes.length) {
    throw new Error("top-level names collide once bundled into one scope:\n" +
      clashes.map((c) => `  "${c.name}" in both ${c.previous} and ${c.file}`).join("\n"));
  }
}
