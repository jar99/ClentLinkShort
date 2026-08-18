/**
 * What a fork has to change, in one place.
 *
 * These values were scattered through the build, the corpus tooling and the CI
 * workflow — the same list of page inputs written out twice, the site address
 * hardcoded in a module nobody would think to look in, each static asset
 * copied by name in its own line of build.mjs. None of that is configuration
 * so much as a series of places to forget.
 *
 * Nothing here is required to run: every value has a working default, so a
 * clone builds unchanged. Point `origin` somewhere else and the canonical
 * link, sitemap, robots.txt, security.txt and CNAME follow it.
 *
 * @module clent.config
 */

/** Where the built site will live. The measured stats override this when they
 *  carry an origin, since the break-even numbers depend on the prefix length. */
export const origin = "https://nul.im/";

/** Directories, relative to the repository root. */
export const dirs = { src: "src", dist: "dist" };

/**
 * Files copied into the build beside the page itself.
 *
 * `stamp` marks a file that carries {{cacheVersion}} and so must be rewritten
 * with the build hash; `minify` runs it through the JS minifier. Adding an
 * asset is a line here rather than an edit to the build's body.
 */
export const assets = [
  { from: "sw.js", stamp: true, minify: true },
  { from: "manifest.webmanifest" },
  { from: "icon.svg" },
];

/**
 * Everything the built page is made from.
 *
 * Two things read this and must agree: the build stamp names the last commit
 * that touched one of these, and the deploy skips when a push touched none of
 * them. They were separate lists, which meant the page could be rebuilt for a
 * change the deploy considered irrelevant, or the reverse.
 */
export const pageInputs = [
  "src",
  "corpus/stats.json",
  "package.json",
  "clent.config.js",
  "tools/build.mjs",
  "tools/bundle.js",
  "tools/minify.js",
];

/** Ports for the dev server and the browser suite; override with PORT. */
export const ports = { serve: 8000, test: 8781 };
