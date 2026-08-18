#!/usr/bin/env node
/**
 * What the deployed site actually sends, against what the README recommends.
 *
 * The page is safe without response headers — that is the design — but several
 * are worth having, and whether they arrived is a fact about a host rather
 * than about this repository. Nothing here can be inferred from the source, so
 * it is asked of the live origin instead.
 *
 *   npm run headers                      # the configured origin
 *   node tools/check-headers.mjs https://example.com/
 *
 * Exit code is 1 if anything recommended is missing, so it can gate a deploy.
 */
import { origin as configuredOrigin } from "../clent.config.js";

const target = process.argv[2] ?? configuredOrigin.replace(/#$/, "");

/**
 * Each check gets a predicate rather than an expected string: several of these
 * are satisfied by more than one value, and a check that only accepts the
 * exact wording in the README would report a working header as missing.
 */
const WANTED = [
  {
    name: "strict-transport-security",
    why: "tells browsers to refuse plain HTTP for this host",
    ok: (v) => {
      const age = Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0);
      if (age < 31536000) {
        return `max-age is ${age}s; the preload list requires at least ` +
          "31536000 (one year), so `preload` does nothing below that";
      }
      // A `preload` token is a claim about a list this cannot see. Say so
      // rather than passing it silently: an unsubmitted domain advertises an
      // intent nobody acted on, and submitting is close to irreversible.
      if (/\bpreload\b/.test(v)) {
        return "max-age is long enough for the preload list, but `preload` " +
          "only means anything once the domain is submitted at " +
          "hstspreload.org — and removal from that list takes months. Drop " +
          "the token or submit it.";
      }
      return true;
    },
  },
  { name: "x-content-type-options", why: "stops MIME sniffing",
    ok: (v) => v.toLowerCase().includes("nosniff") },
  {
    name: "clickjacking",
    why: "frame-ancestors is ignored in a meta tag, so it has to be a header",
    // Either header satisfies this; the page's in-document guard is a
    // fallback for hosts that can send neither, not a replacement.
    read: (h) => h.get("content-security-policy") ?? h.get("x-frame-options") ?? "",
    ok: (v) => /frame-ancestors|DENY|SAMEORIGIN/i.test(v),
  },
  { name: "referrer-policy", why: "the meta tag covers this page's own requests only",
    ok: (v) => /no-referrer|strict-origin/i.test(v) },
  { name: "permissions-policy", why: "declines camera, microphone and geolocation",
    ok: (v) => v.length > 0 },
  { name: "cross-origin-opener-policy", why: "isolates the browsing context",
    ok: (v) => /same-origin/i.test(v) },
];

const response = await fetch(target, {
  redirect: "follow",
  headers: { "user-agent": "clent-header-check" },
});
console.log(`\n${response.url} — ${response.status}\n`);

let missing = 0;
for (const check of WANTED) {
  const value = (check.read ?? ((h) => h.get(check.name) ?? ""))(response.headers);
  const verdict = value ? check.ok(value) : false;
  if (verdict === true) {
    console.log(`  ok    ${check.name}`);
    console.log(`        ${value}`);
  } else {
    missing++;
    console.log(`  MISS  ${check.name} — ${check.why}`);
    if (typeof verdict === "string") console.log(`        ${value}\n        ${verdict}`);
  }
}

// Anything injected into the page is worth knowing about too: a hash-pinned
// policy blocks it, which is correct and also means it does nothing but log.
const body = await response.text();
// Named by the feature that actually controls each one, not by the feature
// people reach for first. The challenge-platform script is JavaScript
// Detections, which is its own toggle: turning Bot Fight Mode off leaves it
// injecting, and the page keeps logging a violation for a setting that looks
// disabled.
const INJECTED = [
  ["JavaScript Detections (Security \u2192 Bots), /cdn-cgi/challenge-platform/",
    /__CF\$cv\$params|challenge-platform/],
  ["AI Labyrinth (Security \u2192 Settings) \u2014 a hidden nofollow link, first in <body>",
    /cdn-cgi\/content\?id=/],
  ["Web Analytics beacon (Analytics \u2192 Web Analytics)", /cloudflareinsights/],
  ["Speed Brain (Speed \u2192 Optimization)", /cdn-cgi\/speculation/],
];
const found = INJECTED.filter(([, pattern]) => pattern.test(body) ||
  pattern.test(response.headers.get("speculation-rules") ?? ""));
console.log(found.length
  ? `\n  injected into the page, and blocked by its policy:\n` +
    found.map(([what]) => `    - ${what}`).join("\n")
  : "\n  nothing injected into the page");

console.log(`\n${WANTED.length - missing}/${WANTED.length} recommended headers present\n`);
process.exit(missing ? 1 : 0);
