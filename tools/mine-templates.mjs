#!/usr/bin/env node
/**
 * Propose template candidates from the corpus, so covering a new site is a
 * paste rather than a research project.
 *
 * For every host with enough URLs, paths are collapsed into shapes: each
 * segment that looks like an identifier becomes a slot, everything else
 * stays literal. Shapes that cover many URLs on that host are printed as
 * ready-to-paste TEMPLATES entries with a suggested slot charset, ranked by
 * how many corpus URLs they would swallow.
 *
 * The output is a PROPOSAL. A human decides what ships, appends it to
 * src/templates.js (append-only — position is the wire encoding), and
 * extends the prefix pin in test/compat.test.js. asTemplate() only ever
 * uses a template when refilling it reproduces the URL byte-for-byte, so a
 * bad proposal can waste a table slot but never repoint a link.
 *
 * Usage:
 *   node tools/mine-templates.mjs             # top 30
 *   node tools/mine-templates.mjs --top 60
 *   node tools/mine-templates.mjs --host reddit.com
 */

import { sampleCorpus } from "./corpus.js";
import { TEMPLATES } from "../src/templates.js";

const args = process.argv.slice(2);
const TOP = args.includes("--top") ? Number(args[args.indexOf("--top") + 1]) : 30;
const ONLY = args.includes("--host") ? args[args.indexOf("--host") + 1] : null;

const SCAN = 400000;
/** A host needs this many corpus URLs before its shapes mean anything. */
const MIN_HOST_URLS = 60;
/** A shape must cover this share of its host's URLs to be worth a slot. */
const MIN_COVERAGE = 0.25;

const covered = new Set(TEMPLATES.map((t) => t.pattern));

/** Does this path segment look like an identifier rather than a word? */
function slotLike(segment) {
  if (segment.length < 3 || segment.length > 63) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) return false;
  // Pure lowercase words ("about", "help") are usually structure, not IDs —
  // unless they carry digits or dashes, which slugs and IDs do.
  if (/^[a-z]+$/.test(segment) && segment.length < 12) return false;
  return true;
}

/** Suggest the cheapest charset that fits every observed value. */
function charsetFor(values) {
  if (values.every((v) => /^[0-9]+$/.test(v))) return "dec";
  if (values.every((v) => /^[A-Za-z0-9_-]+$/.test(v))) return "b64";
  if (values.every((v) => /^[a-z0-9._-]+$/.test(v))) return "slug";
  return "text";
}

/** host -> shape -> {count, values: per-slot samples} */
const hosts = new Map();
let scanned = 0;

for await (const raw of sampleCorpus(SCAN, { salt: "tpl|", hostCap: 0.01 })) {
  let url;
  try {
    url = new URL(raw);
  } catch { continue; }
  if (url.protocol !== "https:") continue;
  if (ONLY && url.host !== ONLY && url.host !== "www." + ONLY) continue;
  if (url.username || url.hash) continue;
  scanned++;

  const path = url.pathname + url.search;
  const segments = path.split(/([/=?&])/);
  const literals = [];
  const values = [];
  for (const segment of segments) {
    if (slotLike(segment)) {
      literals.push(`{${values.length}}`);
      values.push(segment);
    } else {
      literals.push(segment);
    }
  }
  if (!values.length || values.length > 3) continue;
  const shape = `https://${url.host}${literals.join("")}`;
  if (covered.has(shape)) continue;

  let perHost = hosts.get(url.host);
  if (!perHost) hosts.set(url.host, (perHost = { total: 0, shapes: new Map() }));
  perHost.total++;
  let entry = perHost.shapes.get(shape);
  if (!entry) perHost.shapes.set(shape, (entry = { count: 0, values: [] }));
  entry.count++;
  if (entry.values.length < 50) entry.values.push(values);
}

const proposals = [];
for (const [host, { total, shapes }] of hosts) {
  if (total < MIN_HOST_URLS) continue;
  for (const [shape, { count, values }] of shapes) {
    if (count / total < MIN_COVERAGE || count < 20) continue;
    const slots = values[0].map((_, i) => charsetFor(values.map((v) => v[i])));
    proposals.push({ host, shape, count, share: count / total, slots });
  }
}

proposals.sort((a, b) => b.count - a.count);
console.log(`scanned ${scanned} https URLs; ${proposals.length} proposals\n`);
for (const p of proposals.slice(0, TOP)) {
  console.log(`  // ${p.host}: ${p.count} URLs, ${(100 * p.share).toFixed(0)}% of host`);
  console.log(`  { pattern: ${JSON.stringify(p.shape)}, slots: ${JSON.stringify(p.slots)} },`);
}
