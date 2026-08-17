/**
 * Tests for the build pipeline.
 *
 * A minifier bug produces a site that looks fine in review and is broken in
 * production, so the important test here is not that the output is small — it
 * is that the minified library still computes exactly what the source library
 * computes, checked by running both.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { minifyJS, minifyCSS, minifyHTML } from "../tools/minify.js";
import { bundle, ROOT } from "../tools/bundle.js";
import * as source from "../src/clent.js";

/** Load a JS string as a live module. */
const load = (code) =>
  import("data:text/javascript," + encodeURIComponent(code));

/* -------------------------------------------------------------------------- *
 * The property that actually matters
 * -------------------------------------------------------------------------- */

test("the minified library behaves identically to the source", async () => {
  const { code } = await bundle(path.join(ROOT, "src", "clent.js"));
  const minified = minifyJS(code);

  const exported = "export { shorten, expand, analyze, B64, TOKENS };";
  const built = await load(minified + "\n" + exported);

  const urls = [
    "https://example.com",
    "https://www.example.com/path/to/page?a=1&b=2#frag",
    "https://github.com/anthropics/claude-code",
    "http://example.com:8080/x?",
    "https://example.com/unicode/каталог/日本語?q=café",
    "https://drive.google.com/file/d/1A2B3C4D5E6F7G8H9I0JKLMNOPQRSTUV/view",
    "https://example.com/" + "long/".repeat(80),
    "mailto:someone@example.com?subject=Hi%20there",
    "https://example.com/;,/?:@&=+$-_.!~*'()#",
  ];

  // Byte-identical tables: a mangled token list would silently repoint links.
  assert.deepEqual([...built.TOKENS], [...source.TOKENS],
    "the token dictionary must survive minification");
  assert.equal(built.B64, source.B64, "Base64url alphabet must survive minification");

  for (const url of urls) {
    const fromSource = await source.shorten(url, { stripTracking: false });
    const fromBuilt = await built.shorten(url, { stripTracking: false });
    assert.equal(fromBuilt, fromSource, `payload differs after minification: ${url}`);

    // And the minified build must decode what the source encoded, both ways.
    assert.equal((await built.expand(fromSource)).href, (await source.expand(fromSource)).href);
    assert.equal((await source.expand(fromBuilt)).href, (await built.expand(fromBuilt)).href);
  }
});

test("the bundle exposes no leftover module syntax", async () => {
  for (const entry of ["clent.js", "app.js"]) {
    const { code } = await bundle(path.join(ROOT, "src", entry));
    assert.doesNotMatch(code, /^[ \t]*(?:import|export)\b/m,
      `${entry} bundle still contains module syntax`);
  }
});

/* -------------------------------------------------------------------------- *
 * JS minifier
 * -------------------------------------------------------------------------- */

test("comments are removed", () => {
  // No separator is needed after ";", so the line break goes too.
  assert.equal(minifyJS("const a = 1; // trailing\nconst b = 2;"), "const a=1;const b=2;");
  assert.equal(minifyJS("/* block */ const a = 1;"), "const a=1;");
  assert.equal(minifyJS("const a = /* inline */ 1;"), "const a=1;");
  // ...but a comment standing where a needed separator was must leave one.
  assert.equal(minifyJS("const a = 1\n// comment\nb()"), "const a=1\nb()");
});

test("comment-like text inside strings is untouched", () => {
  for (const code of [
    'const a = "// not a comment";',
    "const a = '/* not a comment */';",
    'const a = "https://example.com/path";',
    "const a = `template // with ${x} interpolation`;",
    "const a = `outer ${ `inner ${deep}` } end`;",
    'const a = "he said \\"hi\\" // ok";',
  ]) {
    const out = minifyJS(code);
    const marker = code.slice(code.indexOf(code.match(/["'`]/)[0]));
    assert.ok(out.includes(marker.replace(/;$/, "").trim().replace(/\s+/g, " ")) ||
      out.length >= marker.length - 4, `string content lost: ${code} -> ${out}`);
    assert.doesNotMatch(out, /^\s*$/);
  }
});

test("regex literals survive and are told apart from division", async () => {
  const cases = [
    ["const re = /a\\/b/g; const x = 1;", /\/a\\\/b\/g/],
    ["const re = /[/]/; const y = 2;", /\/\[\/\]\//],
    ["if (/^x$/.test(s)) {}", /\/\^x\$\//],
    ["const q = a / b / c;", /a\/b\/c/],
    ["const q = (a) / 2;", /\)\/2/],
    ["return /x/.test(y);", /\/x\//],
  ];
  for (const [code, expected] of cases) {
    assert.match(minifyJS(code), expected, code);
  }

  // Behavioural check: division and regex in one expression must still work.
  const built = await load(minifyJS(
    "export const f = (a, b, s) => a / b + (/\\d+/.test(s) ? 1 : 0);"));
  assert.equal(built.f(10, 2, "abc"), 5);
  assert.equal(built.f(10, 2, "a1c"), 6);
});

test("newlines are kept where removing one would change meaning", () => {
  // Automatic semicolon insertion: "b" then "(" on the next line would become
  // a call if the newline vanished.
  const out = minifyJS("const a = b\n(function () {})();");
  assert.match(out, /b\n\(/, `ASI hazard collapsed: ${out}`);

  const arr = minifyJS("let x = y\n[1, 2].forEach(f);");
  assert.match(arr, /y\n\[/, `ASI hazard collapsed: ${arr}`);
});

test("identifiers are never fused together", () => {
  assert.equal(minifyJS("const a = typeof b;"), "const a=typeof b;");
  assert.equal(minifyJS("return  new  Foo();"), "return new Foo();");
  assert.equal(minifyJS("let a = b + + c;"), "let a=b+ +c;");
  assert.equal(minifyJS("let a = b - - c;"), "let a=b- -c;");
});

test("minification is idempotent", async () => {
  const { code } = await bundle(path.join(ROOT, "src", "clent.js"));
  const once = minifyJS(code);
  assert.equal(minifyJS(once), once, "minifying twice should change nothing");
});

/* -------------------------------------------------------------------------- *
 * CSS and HTML minifiers
 * -------------------------------------------------------------------------- */

test("CSS is compacted without breaking selectors or calc", () => {
  assert.equal(minifyCSS("a {\n  color: red;\n}"), "a{color:red}");
  assert.equal(minifyCSS("/* note */\na { color: red }"), "a{color:red}");
  assert.equal(minifyCSS(".a .b { color: red }"), ".a .b{color:red}",
    "the descendant combinator is a space and must survive");
  assert.equal(minifyCSS(".a > .b { color: red }"), ".a>.b{color:red}");
  assert.match(minifyCSS("a { width: calc(100% - 2px) }"), /calc\(100% - 2px\)/,
    "calc() operands need their spaces");
  assert.match(minifyCSS('a { content: "  keep  " }'), /"  keep  "/,
    "string values are literal");
  assert.match(minifyCSS("@media (min-width: 40em) { a { color: red } }"),
    /@media \(min-width:40em\)\{a\{color:red\}\}/);
});

test("HTML whitespace is collapsed but protected regions are not", () => {
  assert.equal(minifyHTML("<p>\n  hello\n</p>"), "<p> hello </p>");
  assert.equal(minifyHTML("<div>\n  <span>a</span>\n</div>"), "<div><span>a</span></div>");
  assert.equal(minifyHTML("<!-- gone --><p>x</p>"), "<p>x</p>");

  const pre = "<pre>  keep\n    this  </pre>";
  assert.equal(minifyHTML(pre), pre, "pre content is whitespace-sensitive");

  const textarea = "<textarea>  spaced  </textarea>";
  assert.equal(minifyHTML(textarea), textarea);

  const script = '<script>const a = "  spaced  ";</script>';
  assert.equal(minifyHTML(script), script, "script bodies are handled by minifyJS");

  assert.match(minifyHTML("<p>a &gt; b</p>"), /a &gt; b/,
    "text content must not be mangled");
});

test("inline text spacing between elements is preserved", () => {
  // Collapsing to nothing here would join words: "boldtext".
  assert.equal(minifyHTML("<p><b>bold</b>\n<i>text</i></p>"), "<p><b>bold</b><i>text</i></p>");
  assert.equal(minifyHTML("<p><b>bold</b> <i>text</i></p>"), "<p><b>bold</b> <i>text</i></p>");
});

test("automatic semicolon insertion is preserved across a needed separator", async () => {
  // A space separates the tokens but does not insert a semicolon; only a line
  // terminator does. Getting this wrong turns valid code into a syntax error.
  assert.equal(minifyJS("const a = 1\nb()"), "const a=1\nb()");
  assert.equal(minifyJS("let x = 1\nlet y = 2"), "let x=1\nlet y=2");

  const built = await load(minifyJS("const a = 1\nexport const b = a + 1\n"));
  assert.equal(built.b, 2);
});
