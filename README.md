# Clent

Links that carry their own destination. No database, no backend, no accounts, no logs
— the whole URL is compressed into the link itself, so there is nothing to store and
nothing that can stop working later.

```
https://<user>.github.io/<repo>/#F8oJgxOaSY3d9ZKAA
                                └── the destination is in here
```

The payload sits in the fragment, which browsers don't send to servers. No server
sees where anyone is going.

```sh
npm test              # 59 tests, no dependencies
npm run dev           # serve src/ as real ES modules
npm run build         # one self-contained file in dist/
npm run validate      # round-trip the whole corpus
npm run coverage      # how much of the ranked web the corpus reaches
```

## Is it actually shorter?

Usually not, and that's worth saying up front.

The encoded destination is about **71% of the URL it came from** (median). But every
link also carries this site's address, which is 40 characters before the payload
starts. A URL has to be longer than roughly **295 characters** before that trade comes
out ahead on `jar99.github.io/ClentLinkShort/`.

Measured over 600,000 real URLs:

| Prefix | Break-even URL length | Links that come out shorter |
| --- | --- | --- |
| `jar99.github.io/ClentLinkShort/#` (40c) | ~295 | 0.2% |
| `jar99.github.io/l/#` (27c) | ~205 | 1.8% |
| `clent.link/#` (20c) | ~175 | 8.7% |
| payload alone, no prefix | ~10 | 98.8% |

So the domain matters more than the codec does. What you get regardless of length is a
link nothing is storing, that can't be revoked or logged, and that still resolves when
whoever made it has forgotten about it.

## Validation

`corpus/` holds 600,000 real URLs: Wikipedia citations from 30 language editions,
Hacker News submissions, and domains from the Tranco ranking. Real URLs are messier
than invented ones — doubled slashes, unencoded spaces, mojibake, kilobyte query
strings, session tokens, punycode.

| | |
| --- | --- |
| URLs round-tripped | **600,000** |
| Decoded to the byte-identical original | **100%**, 0 failures |
| Encoded worse than an available alternative | **0** |
| Payload vs input URL | **75.4%** overall, median **70.7%** |
| Payload shorter than input | **98.8%** |
| Winning body mode | text6 98.9%, deflate 0.9%, raw 0.2% |

Plus a sweep of every domain in the Tranco top 1M:

| | |
| --- | --- |
| Ranked domains round-tripped | **1,000,000** |
| Failures | **0** |

CI fails on a single mismatch. A link that silently resolves to the *wrong* place is
much worse than one that fails loudly, so that is the number held at zero.

The page quotes these figures but doesn't hard-code them: the build substitutes from
`corpus/stats.json`, and CI diffs that file against a fresh measurement.

### Does it pick the best encoding?

Yes, and this is checked rather than assumed.

`tools/optimality.js` builds a payload for every combination of every choice the
encoder has — both spellings of the host, dictionary or spelled out, verbatim, crossed
with all three body modes, about a dozen per URL. It confirms each one decodes back to
the same URL, then asserts the encoder's answer is no longer than the best of them.

It found a real bug. The encoder used to strip a `www.` prefix on sight, which looks
free: four characters traded for a header bit that was already paid for. Once the token
dictionary arrived that stopped being true, because entries like `.wikipedia` match
inside `www.wikipedia.org` and cannot match `wikipedia.org`. On
`http://www.wikipedia.org/wiki/Perseus` stripping cost more than it saved.

The fix was to stop encoding a rule about it. `shorten()` now builds every shape and
keeps the smallest, so that class of bug can't come back — and the check still runs
over the corpus as an independent implementation of the same question. It currently
finds no URL that could have been encoded smaller.

Within text6, token selection is a shortest-path problem rather than a greedy one:
taking a long token can step over the start of a better one. The encoder solves it with
dynamic programming, so the text6 body it produces is provably minimal.

### About covering "95% of the internet"

There's no way to measure that, and any hard number for it is a guess. Two things can
be measured instead:

- **The sweep.** Every one of the top 1,000,000 ranked domains is round-tripped
  through the codec. That's 100% of the ranked web, not 95%.
- **Corpus reach.** Mapping each corpus URL onto the Tranco ranking gives the share of
  ranked traffic the corpus's own links represent. Turning a rank into a traffic share
  needs a model — popularity is roughly Zipfian, so rank *r* is weighted 1/*r*ˢ — and
  `npm run coverage` prints the exponent alongside the answer, because the answer
  depends on it.

  | Rank tier | Present in the corpus |
  | --- | --- |
  | top 1,000 | 99.8% |
  | top 10,000 | 99.9% |
  | top 100,000 | 100% |
  | top 1,000,000 | 15.4% |

  Traffic-weighted reach at Zipf *s*=1: **86.4%**. The corpus also contains 108,000
  distinct hosts that aren't ranked at all, which is the tail past the top million.

### DuckDuckGo

Asked for, and not used. Its `html.` and `lite.` endpoints answer scripted requests
with a bot-detection challenge (HTTP 202 and an "anomaly" page); getting around that
means defeating an anti-abuse control. Its public API is the Instant Answer API, which
returns encyclopaedia summaries and `duckduckgo.com` disambiguation links rather than
web results — a few dozen usable URLs per thousand requests. There is no supported way
to get a result feed out of it.

The sources in `tools/sources.js` are the ones that publish an API for this and
paginate deeply enough to matter. GDELT and Stack Exchange are implemented and
reachable but left out of the default mix: both rate-limit hard enough to cost minutes
for a couple of percent of the corpus. Use `--source` if you want them.

## Using the codec

Zero dependencies, ES module, runs unmodified in browsers and Node ≥ 18.

```js
import { shorten, expand, analyze } from "./src/clent.js";

const payload = await shorten("https://example.com/a/long/path?utm_source=x");
const url = await expand(payload);
url.href;   // "https://example.com/a/long/path"
```

`analyze()` returns every decision the encoder made — winning mode, what each
candidate would have cost, whether the host hit the dictionary, which parameters were
dropped, how the bits were spent. The page's breakdown panel is a rendering of it.

Full types in [`src/clent.d.ts`](src/clent.d.ts).

### Safety

`expand()` guarantees its result has a scheme in `ENCODABLE` and throws `ClentError`
otherwise. A fragment is entirely attacker-controlled, so this is the contract that
makes auto-redirecting safe. `javascript:`, `data:`, `vbscript:`, `blob:` and `file:`
are refused when encoding and when decoding, including through the verbatim path.
`isFollowable()` narrows to `http:`/`https:` for automatic navigation; anything else
needs a click.

Append `~` to a link to preview where it goes instead of going there.

## How the encoding works

1. **Tracking parameters are removed** — `utm_*`, `fbclid`, `gclid` and similar. Worth
   about 41% of the payload on a link that has them. It's the only step that changes
   the destination, so it's a switch rather than a default.
2. **The predictable parts become bits.** Scheme, `www.` and a trailing slash cost 12
   characters in a normal URL; here they're 3 bits in a 6-bit header.
3. **165 common hosts collapse to one byte.**
4. **The rest is encoded three ways and the shortest is kept:**
   - **text6** packs each byte as a 6-bit symbol written straight into the Base64url
     alphabet. Base64 is also 6 bits per character, so a lowercase URL comes out the
     same length it went in. A 64-entry substring dictionary (`.com`, `article`,
     `/index`, `wiki`…) replaces common runs with 12 bits each, which removes about
     12% of the body. Capitals cost a shift symbol; anything else escapes to a literal
     byte.
   - **raw** is plain 8-bit bytes, which wins on uppercase-dense IDs where text6's
     shift symbols would cost 12 bits per character instead of 8.
   - **deflate** wins once a URL is long or repetitive enough to repay its overhead.

   Encoding naively as bytes-then-Base64 costs 1.33 characters per character. text6
   costs 1.0 or less.

The payload is one continuous bit stream, so nothing rounds up to a byte and there's
no padding.

### Wire format v3

```
6 bits   header   bits 0-1  scheme: 0 = https://, 1 = http://, 2 = verbatim
                  bit  2    "www." was stripped
                  bit  3    host came from the dictionary
                  bits 4-5  body mode: 0 = text6, 1 = raw, 2 = deflate
8 bits   host     dictionary index — only when bit 3 is set
body     text6    6-bit symbols: 0-58 literal, 59 TOKEN (+6-bit index),
                  61 SHIFT, 62 ESC (+8-bit byte), 63 END
         raw      UTF-8 bytes, 8 bits each
         deflate  DEFLATE-raw bytes, 8 bits each
```

The body is `host + /path?query#frag`, or just the tail when the host is
dictionary-encoded, or the whole URL when the scheme is verbatim.

Two details that are load-bearing:

- The tail comes from `url.href`, not `pathname + search + hash` — the latter drops a
  trailing empty `?` or `#`, which changes the destination. Caught by fuzzing.
- URLs with `user:password@` are always stored verbatim. The compact form has nowhere
  to keep userinfo and dropping it would repoint the link.

Both `HOSTS` and `TOKENS` are **append-only**: an entry's index is its wire encoding,
so reordering one repoints every link that used it.

## Project layout

```
src/clent.js      the codec — zero dependencies, browser and Node
src/hosts.js      host dictionary (append-only)
src/tokens.js     text6 substring dictionary (append-only)
src/clent.d.ts    hand-written types
src/index.html    the page
src/app.js        the two views: link maker and redirector
src/style.css

test/             59 tests on node:test
  bits            bit stream round-trips at every width
  codec           encoding, edge cases, mode and token selection
  security        hostile fragments, scheme allowlists, exhaustive short sweeps
  property        generated URLs, truncation, bit-flips, random payloads
  corpus          the real-URL corpus
  optimality      brute-force check that no smaller encoding existed
  minify          that the minified library computes what the source computes

tools/            fetch-corpus, sources, corpus, validate-corpus, coverage,
                  optimality, bundle, minify, build, serve, browser-test
```

## Build and delivery

The page is a redirector, so the gap between a click and knowing where to go is the
whole experience. The build inlines the module graph, stylesheet and icon into one
file.

```
Source  ~50 kB across 6 files
Built   ~31 kB raw · ~11 kB gzip · ~10 kB brotli · 1 request
```

The minifier is a tokeniser, not a pile of regexes: it tracks strings, template
literals with nested `${}`, regex literals and both comment forms, and keeps newlines
wherever removing one would change meaning through automatic semicolon insertion. It
does not rename identifiers.

It's verified rather than trusted. `test/minify.test.js` minifies the real library,
loads it, and asserts byte-identical payloads to the source.
`tools/browser-test.mjs` drives the built page in Chromium — 19 checks covering
redirects, preview mode, hostile fragments, that the creator UI never flashes during a
redirect, that nothing is written to storage, and that the built page is one request.

That caught two real bugs: the minifier turning `const a = 1\nb()` into a syntax error
by replacing a newline with a space (only a line terminator triggers semicolon
insertion), and the page's view switch being done in JS, so the creator UI flashed in
front of anyone who had merely clicked a link.

## Deploying

Push to `main`. The workflow tests, builds and publishes `dist/`; set
**Settings → Pages → Source** to **GitHub Actions**.

`dist/404.html` is a copy of the app, so a mistyped path still resolves its fragment.

## Browser support

Needs `CompressionStream`/`DecompressionStream` with `deflate-raw` for the deflate
mode — Chrome 103+, Firefox 113+, Safari 16.4+. Without it, links still work; deflate
just isn't offered as a candidate, which costs about 1% of links some length.

## Licence

MIT.
