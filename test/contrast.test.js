/**
 * Text has to be readable, and "looks fine to me" is not a measurement.
 *
 * Every colour pair the page actually renders text in is checked against the
 * WCAG AA threshold of 4.5:1. This caught the hint text under every option in
 * the maker — 3.83:1 in light and 3.71:1 in dark, on both themes at once,
 * which is the sort of thing that survives indefinitely because it looks
 * merely "subtle" to whoever picked it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** WCAG relative luminance. */
function luminance(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** Pull the custom properties out of a `:root`-ish block. */
function tokens(css, from) {
  const start = css.indexOf(from);
  assert.notEqual(start, -1, `stylesheet should contain ${from}`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const css = await readFile(path.join(ROOT, "src", "style.css"), "utf8");
const themes = {
  light: tokens(css, ":root {"),
  dark: tokens(css, "@media (prefers-color-scheme: dark)"),
};

// Text colour against the surface it is drawn on. Every one of these pairs
// appears on the page; a pair that stops being used should leave this list.
const PAIRS = [
  ["ink", "bg"],
  ["ink", "panel"],
  ["ink-soft", "panel"],
  ["ink-soft", "bg"],
  ["ink-faint", "panel"],
  ["ink-faint", "bg"],
  ["accent", "panel"],
  ["good", "panel"],
  ["bad", "panel"],
];

for (const [name, palette] of Object.entries(themes)) {
  test(`${name} theme text meets WCAG AA`, () => {
    for (const [ink, surface] of PAIRS) {
      const fg = palette[ink], bg = palette[surface];
      assert.ok(fg && bg, `${name}: missing --${ink} or --${surface}`);
      const ratio = contrast(fg, bg);
      assert.ok(ratio >= 4.5,
        `${name}: --${ink} (${fg}) on --${surface} (${bg}) is ${ratio.toFixed(2)}:1, ` +
        "below the 4.5:1 WCAG AA needs for body text");
    }
  });
}

test("every custom property the stylesheet uses is one it defines", () => {
  // A var() naming a token that does not exist is silent: the declaration is
  // dropped and the element inherits whatever its parent had. That is how
  // .faq dd and .maker-note lost their muted colour, and how the language
  // picker's select ended up transparent — all three looked plausible enough
  // that nobody noticed. There is no browser warning for it, so this is it.
  const defined = new Set(
    [...css.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map(([, name]) => name));
  const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(([, name]) => name));
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, [], "used but never defined");
});

test("the page tells the browser which palette its own widgets should use", () => {
  // Without color-scheme the UA paints selects, their popups, checkboxes and
  // scrollbars light no matter what the page does — so the dark theme opened
  // a white popup holding near-white option text. Naming both schemes makes
  // the UA follow prefers-color-scheme, which is what the palette already does.
  assert.match(css, /color-scheme:\s*light dark/,
    ":root needs `color-scheme: light dark` for native controls to follow the theme");
});

test("no form control is small enough to make iOS zoom on focus", () => {
  // Safari zooms the viewport when a control under 16px takes focus, which
  // throws the layout off and cannot be undone from inside the page. The rule
  // was written in a comment beside the inputs and then not applied to the
  // selects, so it is a test now.
  const controls = /(^|,|\s)(textarea|select|input)\b[^{]*\{([^}]*)\}/g;
  for (const [, , control, body] of css.matchAll(controls)) {
    const size = /font(?:-size)?:\s*(?:[^;]*?\b)?(\d+(?:\.\d+)?)(px|rem)\b/.exec(body);
    if (!size) continue;
    const px = size[2] === "rem" ? Number(size[1]) * 16 : Number(size[1]);
    assert.ok(px >= 16,
      `<${control}> is ${px}px; anything under 16px makes iOS zoom on focus`);
  }
});
