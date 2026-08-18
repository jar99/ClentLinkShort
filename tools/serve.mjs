#!/usr/bin/env node
/**
 * A static file server for local development and for the browser tests.
 *
 * Exists so that `npm run dev` needs nothing installed: `src/` is served as
 * real ES modules exactly as the browser will load them, and `dist/` can be
 * served identically to check the built output behaves the same.
 *
 * Usage: node tools/serve.mjs [dir] [--port 8000]
 */

import { createServer } from "node:http";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ports } from "../clent.config.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dir = path.resolve(ROOT, args.find((a) => !a.startsWith("--")) ?? "src");
const portAt = args.indexOf("--port");
const port = Number(portAt === -1 ? process.env.PORT || ports.serve : args[portAt + 1]);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Compress what a real host would compress.
 *
 * Serving plain bytes locally is not a small inaccuracy: the page is 120 kB
 * raw and 33 kB brotli, so an uncompressed dev server makes every timing
 * measurement one of a document nobody is ever sent. It quietly turned the
 * performance harness into a test of the wrong page, so the server does what
 * GitHub Pages and Cloudflare both do instead.
 */
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg",
  ".webmanifest", ".xml", ".txt"]);

const compress = (body, extension, accept = "") => {
  if (!COMPRESSIBLE.has(extension) || body.length < 512) return [body, null];
  if (/\bbr\b/.test(accept)) {
    return [brotliCompressSync(body,
      { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }), "br"];
  }
  if (/\bgzip\b/.test(accept)) return [gzipSync(body, { level: 9 }), "gzip"];
  return [body, null];
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const target = path.join(dir, decodeURIComponent(url.pathname));

  // Refuse anything that escapes the served directory. A prefix test is not
  // enough: "src" is a prefix of "src-private", so a sibling whose name starts
  // with the served directory's would pass one. Ask for the relative path
  // instead and require that it stays inside.
  const inside = path.relative(dir, target);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let file = target;
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const raw = await readFile(file);
    const extension = path.extname(file);
    const [body, encoding] =
      compress(raw, extension, request.headers["accept-encoding"]);
    response.writeHead(200, {
      "content-type": TYPES[extension] ?? "application/octet-stream",
      "cache-control": "no-store",
      vary: "accept-encoding",
      ...(encoding ? { "content-encoding": encoding } : {}),
    });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, () => {
  console.log(`Serving ${path.relative(ROOT, dir) || "."} on http://localhost:${port}`);
});
