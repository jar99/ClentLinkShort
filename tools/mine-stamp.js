/**
 * Skip a mining run that would reproduce the table already shipped.
 *
 * Mining reads millions of URLs to emit a few kilobytes of Huffman table. The
 * miners are deterministic — sampling admits each URL by its own hash, so the
 * sample does not depend on file order or on how much of the corpus is read —
 * which means identical inputs give a byte-identical table. There is no point
 * spending the minutes to find that out.
 *
 * So each miner declares what it actually reads: its own source, the shared
 * sampler, whichever shipped tables it consults, and the parameters it was
 * invoked with. Those are hashed together with the corpus's own content hash.
 * If the result matches the stamp recorded when the shipped table was written,
 * the run is a no-op and says so.
 *
 * The failure mode is deliberately one-sided. Declaring too many dependencies
 * costs an unnecessary re-mine; declaring too few would let a stale table
 * survive a change that should have moved it. When in doubt, over-declare.
 *
 * @module mine-stamp
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./bundle.js";

const STAMP_FILE = path.join(ROOT, "tools", "mine-stamp.json");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The corpus's identity, from the manifest the fetcher writes. */
async function corpusIdentity() {
  const manifest = JSON.parse(
    await readFile(path.join(ROOT, "corpus", "manifest.json"), "utf8"));
  // sha256 is over the corpus text itself, so it moves whenever a URL does.
  return { sha256: manifest.sha256, total: manifest.total };
}

async function readStamps() {
  try {
    return JSON.parse(await readFile(STAMP_FILE, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {string} name miner key, e.g. "text"
 * @param {{files: string[], params?: object, force?: boolean}} options
 *   `files` are repo-relative paths this miner's output depends on.
 * @returns {Promise<{unchanged: boolean, message: string, save: () => Promise<void>}>}
 */
export async function mineGuard(name, { files, params = {}, force = false }) {
  const corpus = await corpusIdentity();
  const sources = {};
  for (const file of [...files].sort()) {
    sources[file] = sha256(await readFile(path.join(ROOT, file)));
  }
  const fingerprint = sha256(JSON.stringify({ corpus, sources, params }));

  const stamps = await readStamps();
  const previous = stamps[name];
  const unchanged = !force && previous?.fingerprint === fingerprint;

  return {
    unchanged,
    message: unchanged
      ? `${name}: nothing that affects the table has changed since it was mined ` +
        `(${previous.mined}) — the run would reproduce it exactly. Use --force to mine anyway.`
      : "",
    async save() {
      const next = await readStamps();
      next[name] = {
        fingerprint,
        // Provenance, not just a cache key: this records which corpus the
        // shipped table was actually trained on.
        corpus: `${corpus.total} URLs, sha256 ${corpus.sha256.slice(0, 16)}`,
        mined: new Date().toISOString().slice(0, 10),
      };
      const ordered = Object.fromEntries(Object.entries(next).sort());
      await writeFile(STAMP_FILE, JSON.stringify(ordered, null, 2) + "\n");
    },
  };
}
