#!/usr/bin/env node
/**
 * Fetch the corpus from its release asset.
 *
 * The corpus is not in the repository. It is 66 MB of brotli, and brotli does
 * not delta-compress, so committing each snapshot added its whole size to
 * every future clone — four snapshots had already put 144 MB of blobs in a
 * 158 MB .git. As a release asset it is downloaded once, by the people and
 * the CI jobs that actually need it.
 *
 * corpus/manifest.json names the snapshot and carries its sha256, so what
 * arrives is checked rather than trusted: a truncated download or a swapped
 * asset fails here instead of quietly changing what "validated" means.
 *
 * Usage:
 *   node tools/get-corpus.mjs           # no-op if the file is already right
 *   node tools/get-corpus.mjs --force   # re-download even so
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";

import { ROOT } from "./bundle.js";

const CORPUS = path.join(ROOT, "corpus", "urls.txt.br");

async function hashOf(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")))
      .on("error", reject);
  });
}

const manifest = JSON.parse(
  await readFile(path.join(ROOT, "corpus", "manifest.json"), "utf8"));
const { asset, total } = manifest;
// The compressed bytes are what travels; manifest.sha256 covers the
// decompressed corpus, which would mean inflating 238 MB just to check a
// download. asset.sha256 answers the question actually being asked.
const want = asset?.sha256;
if (!asset?.url || !want) {
  throw new Error("corpus/manifest.json needs asset.url and asset.sha256 to fetch");
}

if (!process.argv.includes("--force")) {
  try {
    if (await hashOf(CORPUS) === want) {
      console.log(`corpus already present and verified (${total.toLocaleString("en-US")} URLs)`);
      process.exit(0);
    }
    console.log("corpus present but does not match the manifest; re-fetching");
  } catch { /* missing: fetch it */ }
}

console.log(`fetching ${asset.url}`);
const response = await fetch(asset.url, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`${response.status} ${response.statusText} fetching the corpus asset`);
}
const bytes = new Uint8Array(await response.arrayBuffer());

// Written to a temporary name and renamed only once the hash checks out, so an
// interrupted or wrong download can never be mistaken for the real corpus.
const got = createHash("sha256").update(bytes).digest("hex");
if (got !== want) {
  throw new Error(`corpus hash mismatch\n  expected ${want}\n  got      ${got}`);
}
await mkdir(path.dirname(CORPUS), { recursive: true });
await writeFile(CORPUS + ".part", bytes);
await rename(CORPUS + ".part", CORPUS);
console.log(`corpus verified and written (${total.toLocaleString("en-US")} URLs, ` +
  `${(bytes.length / 1048576).toFixed(1)} MB)`);
