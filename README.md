# Clent

A URL shortener that **stores nothing**, and the codec behind it.

There is no database, no backend, no accounts and no logging — not because they are
switched off, but because there is nowhere for them to be. The destination is
compressed into the link itself, so the link *is* the record. It cannot expire, cannot
be revoked, and cannot be mined.

```
https://<user>.github.io/<repo>/#F8oJgxOaSY3d9ZKAA
                                └── the destination lives here
```

The payload rides in the URL **fragment**, which browsers never transmit. GitHub's
servers never see where anyone is going.

```sh
npm test        # 50 tests: unit, property, security, minifier — no dependencies
npm run dev     # serve src/ as real ES modules
npm run build   # one self-contained file in dist/
npm run validate  # round-trip 200,000 real URLs
```

## Validation

Synthetic URLs only prove a codec handles what its author imagined. `corpus/` holds
200,000 real ones — external links cited on Wikipedia, links submitted to Hacker News,
and the Majestic Million domain ranking. They carry doubled slashes, unencoded spaces,
mojibake, kilobyte query strings, session tokens and punycode.

| | |
| --- | --- |
| URLs checked | **200,000** |
| Decoded to the byte-identical original | **100%** — 0 failures |
| Payloads shorter than their input URL | **98.4%** |
| Payload size vs input | **82.3%** overall, median **76.7%**, p90 **92.2%** |
| Hosts hitting the dictionary | **11.5%** |
| Winning body mode | text6 98.4%, deflate 1.0%, raw 0.5% |

Round-trip failures are held at **zero**, and CI fails on a single mismatch. A link
that silently resolves to the *wrong* destination is far worse than one that fails
loudly, so that is the number that matters.

The homepage quotes these figures, but they are not typed into the markup: the build
substitutes them from `corpus/stats.json`, and CI diffs that file against a fresh
measurement. The page cannot drift into advertising numbers the codec no longer earns.

```sh
npm run corpus:fetch                  # rebuild the corpus from the live sources
npm run corpus:fetch -- --count 500000
npm run validate -- --limit 5000
```

### An honest result

The corpus **disproved** a claim that was in this README's first draft. Stripping
tracking parameters was described as "usually the single biggest saving". Measured, it
is worth **36% of the payload when parameters are present** — but only 11 of the
200,000 corpus URLs carry any, because all three sources are pre-cleaned (Wikipedia
curates citations, Hacker News strips them, Majestic is bare domains). The saving is
real and large; "usually" was wrong for links of this kind. Newsletter and social
links, which the corpus does not sample, are a different story.

## Using the codec

Zero dependencies, ES module, works unmodified in browsers and Node ≥ 18.

```js
import { shorten, expand, analyze } from "./src/clent.js";

const payload = await shorten("https://example.com/a/long/path?utm_source=x");
// → "AEXAMPLEnCOMkAkLONGkPATH_"

const url = await expand(payload);      // → URL
url.href;                                // "https://example.com/a/long/path"
```

`analyze()` returns everything the encoder decided — the winning mode, the length each
candidate would have been, whether the host hit the dictionary, which parameters were
dropped, and how the bits were spent. The homepage's breakdown panel is just a
rendering of it.

```js
const a = await analyze("https://github.com/anthropics/claude-code");
// { payload: "IAJADUx0TjyAkpAiwFAxJQjgxPw", modeName: "text6", hostByte: 0,
//   headerBits: 14, bodyBits: 148,
//   candidates: { text6: 27, raw: 33, deflate: 36 }, ... }
```

Full types in [`src/clent.d.ts`](src/clent.d.ts).

### Safety

`expand()` guarantees its result has a scheme in `ENCODABLE`, and throws `ClentError`
for everything else — a fragment is entirely attacker-controlled, so this is the
contract that makes auto-redirecting safe. `javascript:`, `data:`, `vbscript:`,
`blob:` and `file:` are refused when encoding *and* when decoding, including through
the verbatim path. `isFollowable()` narrows further to `http:`/`https:` for automatic
navigation; anything else requires a human click.

Appending `~` to a link previews the destination instead of following it.

## How the encoding works

In order of how much each step saves:

1. **Tracking parameters are stripped** — `utm_*`, `fbclid`, `gclid`, `igshid`, `si`
   and friends. The only step that changes the destination rather than re-encoding it,
   hence the visible switch.
2. **Canonicalisation** — the scheme, a `www.` prefix and a trailing slash become
   individual *bits* in a 6-bit header rather than the twelve characters they cost.
3. **Host dictionary** — 165 common hosts collapse to a single byte.
4. **Three competing body encodings**, of which the shortest is kept:

   - **text6** packs each URL byte as a 6-bit symbol written *directly into the
     Base64url alphabet*. Since Base64 is itself 6 bits per character, an ordinary
     lowercase URL comes out at **exactly one character per character** — no expansion
     at all. Capitals cost a shift symbol; anything else escapes to a literal byte.
   - **raw** is plain 8-bit bytes, which wins on uppercase-dense ID tokens where
     text6's shift symbols would cost 12 bits per character instead of 8.
   - **deflate** uses `CompressionStream("deflate-raw")` and wins once a URL is long
     or repetitive enough to repay its overhead.

   Encoding naively as bytes-then-Base64 costs 1.33 characters per character. This
   costs 1.0 or less. On the corpus, text6 wins 98.4% of the time.

The whole payload is one continuous bit stream, so nothing rounds up to a byte
boundary and there is no padding.

### Wire format v2

```
6 bits   header   bits 0-1  scheme: 0 = https://, 1 = http://, 2 = verbatim
                  bit  2    "www." was stripped from the host
                  bit  3    host came from the dictionary
                  bits 4-5  body mode: 0 = text6, 1 = raw, 2 = deflate
8 bits   host     dictionary index — only when bit 3 is set
body     text6    6-bit symbols; 0-60 literal, 61 SHIFT, 62 ESC, 63 END
         raw      UTF-8 bytes, 8 bits each
         deflate  DEFLATE-raw bytes, 8 bits each
```

The body is `host + /path?query#frag`, or just the tail when the host is
dictionary-encoded, or the entire URL when the scheme is verbatim.

Two details that are load-bearing:

- The tail is sliced out of `url.href`, not assembled from `pathname + search + hash`
   — the latter silently discards a trailing empty `?` or `#`, which changes the
   destination. This was a real bug, caught by fuzzing.
- URLs carrying `user:password@` are always stored verbatim. The compact form has
   nowhere to keep userinfo, and dropping it would repoint the link.

The host dictionary is **append-only**: an entry's index *is* its wire encoding, so
reordering or removing one silently repoints every link already shared.

## The honest trade-off

Without storage, a link can never be shorter than the information it carries. That is
arithmetic, not an implementation detail. Long, parameter-heavy URLs — the ones people
actually want shortened — compress well. Already-terse ones come out longer. The UI
shows both lengths and says plainly which happened.

| Input | Input | Payload |
| --- | --- | --- |
| `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&utm_source=newsletter` | 71 | 34 |
| `https://en.wikipedia.org/wiki/Uniform_Resource_Locator` | 54 | 37 |
| `https://github.com/anthropics/claude-code/blob/main/README.md` | 61 | 53 |
| `https://example.com` | 19 | 13 |

Fixed overhead is your Pages origin, added on top of the payload. `jar99.github.io/l/#…`
beats `jar99.github.io/ClentLinkShort/#…` by 13 characters on *every link ever made* —
more than any further work on the codec would win.

## Project layout

```
src/clent.js      the codec — zero dependencies, browser and Node
src/hosts.js      the append-only host dictionary
src/clent.d.ts    hand-written types
src/index.html    the page
src/app.js        the two views: link maker and redirector
src/style.css

test/             50 tests on node:test — no test framework to install
  bits            bit stream round-trips at every width
  codec           encoding, edge cases, mode selection
  security        hostile fragments, scheme allowlists, exhaustive short sweeps
  property        3,000 generated URLs, truncation, bit-flips, 20,000 random payloads
  corpus          the real-URL corpus
  minify          that the *minified* library computes what the source computes

tools/            fetch-corpus, validate-corpus, bundle, minify, build, serve,
                  browser-test
```

## Build and delivery

The page is a redirector, so the time between a click and the browser knowing where to
go is the entire experience. Every extra request is a round trip added to that, so the
build inlines the module graph, the stylesheet and the icon into one file.

```
Source  49.9 kB across 5 files
Built   30.5 kB raw · 11.3 kB gzip · 9.8 kB brotli · 1 request
```

The minifier is a proper tokeniser, not a pile of regexes: it tracks strings, template
literals with nested `${}`, regex literals and both comment forms, and preserves
newlines wherever removing one would change meaning through automatic semicolon
insertion. It does **not** rename identifiers — that needs a real parser, and a parser
bug in a build tool produces a site that only breaks in production.

It is verified rather than trusted. `test/minify.test.js` bundles and minifies the real
library, loads it, and asserts it produces byte-identical payloads to the unminified
source for the same inputs. `tools/browser-test.mjs` then drives the built page in
Chromium — 19 checks covering redirects, preview mode, hostile fragments, that the
creator UI never flashes during a redirect, that nothing is written to storage, and
that the built page is exactly one request.

This caught two real bugs: the minifier turning `const a = 1\nb()` into a syntax error
by replacing a newline with a space (only a line terminator triggers semicolon
insertion), and the page's view switch being done in JS, so the creator UI flashed in
front of anyone who merely clicked a link.

## Deploying

Push to `main`. The workflow tests, builds and publishes `dist/`; set
**Settings → Pages → Source** to **GitHub Actions**.

`dist/404.html` is a copy of the app, so a mistyped path still resolves its fragment
instead of dead-ending.

## Browser support

Needs `CompressionStream`/`DecompressionStream` with `deflate-raw` for the deflate mode
— Chrome 103+, Firefox 113+, Safari 16.4+. Where it is missing, links are still created
and opened correctly; deflate is simply not offered as a candidate, which costs
roughly 1% of links some length.

## Licence

MIT.
