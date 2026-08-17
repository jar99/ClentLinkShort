# Clent

A privacy-focused, open-source link shortener, live at **[nul.im](https://nul.im)**.
No database, no backend, no accounts, no logs — the whole URL is compressed into the
link itself, so there is nothing to store and nothing that can stop working later.
MIT-licensed; fork it and it runs on any static host.

```
https://nul.im/#F8oJgxOaSY3d9ZKAA
               └── the destination is in here
```

The payload sits in the fragment, which browsers don't send to servers. No server
sees where anyone is going.

```sh
npm test              # 134 tests, no dependencies
npm run dev           # serve src/ as real ES modules
npm run build         # one self-contained file in dist/
npm run validate      # round-trip the whole corpus
npm run coverage      # how much of the ranked web the corpus reaches
```

## Is it actually shorter?

More often than before, and the numbers are measured, not hoped.

The encoded destination is **56% of the URL it came from** (median). Every link also
carries the site's address — 16 characters on `nul.im` — so a URL only has to be
longer than about **25 characters** before the whole link comes out shorter. That is
most links people actually share: **79% of deep links** (anything past a bare
homepage) shrink, and popular shapes do far better still — a timestamped YouTube
share is 49 characters in, 17 out.

Measured over 643,949 real URLs:

| Prefix | Break-even URL length | Links that come out shorter |
| --- | --- | --- |
| `nul.im/#` (16c) | ~25 | 46.7% |
| a github.io project page (40c) | ~110 | 8.9% |
| payload alone, no prefix | ~10 | 99.9% |

Bare homepages (43% of the corpus) are the one shape that rarely wins — there is
nothing to compress away. What you get regardless of length is a link nothing is
storing, that can't be revoked or logged, and that still resolves when whoever made
it has forgotten about it.

## Compared to ha.mr

[ha.mr](https://github.com/p2r3/ha.mr) is the other static URL compressor — bit-level
canonicalisation, a Huffman-coded domain dictionary, Huffman text. Running its actual
encoder head-to-head over 3,999 corpus URLs:

| | Clent | ha.mr |
| --- | --- | --- |
| Total payload, same 3,999 URLs | **147,141 chars** | 151,216 chars |
| Decodes back byte-identical | **100%** | 83.4% |
| Output alphabet | 64 chars, Base64url | 84 chars incl. `[ ] ' ( ) , ;` |
| `watch?v=…&t=36s` (its own demo) | **17** | 27 |
| `upload.wikimedia.org/...%22Agnese%22...` | **134** | 160 |
| Shorter link, per URL | 34.4% | 55.3% |

Read the last row with the others: ha.mr's per-URL edge is many 1–3-character wins on
long-tail text, bought mostly by the wider output alphabet — and characters like
`[](),'` are exactly the ones chat apps cut links off at, which is why Clent refuses
them. Its 16.6% of non-identical decodes are lossy canonicalisation (dropped trailing
slashes, `%28` decoded to `(`, case changes): usually harmless, sometimes a different
page. Clent holds byte-exactness at 100% across the full 643,949 and fails loudly
otherwise. On security, the comparison is one-sided: scheme allowlisting on encode and
decode, phishing-shape interception, hash-pinned CSP, integrity tags and signing, and
bounded decompression are all Clent-only.

## Validation

`corpus/` holds 643,949 real URLs from six sources, weighted towards the kinds of link
people actually shorten:

| Source | What it contributes |
| --- | --- |
| Wikipedia, 30 language editions | citations — messy, old, heavily percent-encoded |
| Tranco top 1M | ranked domains, head-weighted |
| Hacker News | submitted links |
| Lemmy, 8 instances | social posts: news, deals, images |
| Wikimedia Commons | image URLs on a CDN host |
| 36 RSS/Atom feeds | news articles and shopping deals |

| | |
| --- | --- |
| URLs round-tripped | **643,949** |
| Decoded to the byte-identical original | **100%**, 0 failures |
| Encoded worse than an available alternative | **0** |
| Payload vs input URL | **62.9%** overall, median **56.1%** |
| Payload shorter than input | **99.9%** |
| Host dictionary hit rate | **11.2%** |
| Carried tracking parameters | **3.6%**, worth 26% of the payload on those |
| Winning body mode | host 78.1%, text 15.8%, template 5.7%, deflate 0.3%, raw 0.1% |

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
encoder has — both spellings of the host, dictionary, host field or spelled out,
verbatim, crossed with every body mode, over a dozen per URL. It confirms each one
decodes back to the same URL, then asserts the encoder's answer is no longer than the
best of them.

It found a real bug. The encoder used to strip a `www.` prefix on sight, which looks
free: four characters traded for a header bit that was already paid for. Once the token
dictionary arrived that stopped being true, because entries like `.wikipedia` match
inside `www.wikipedia.org` and cannot match `wikipedia.org`. On
`http://www.wikipedia.org/wiki/Perseus` stripping cost more than it saved.

The fix was to stop encoding a rule about it. `shorten()` now builds every shape and
keeps the smallest, so that class of bug can't come back — and the check still runs
over the corpus as an independent implementation of the same question. It currently
finds no URL that could have been encoded smaller.

Within the text mode, token selection is a shortest-path problem rather than a greedy
one: taking a long token can step over the start of a better one. The encoder solves it
with dynamic programming against the shipped Huffman costs, so the text body it
produces is provably minimal for those tables — and an independent DP in the tests
checks exactly that.

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
  | top 1,000,000 | 23.9% |

  Traffic-weighted reach at Zipf *s*=1: **89.8%**. The corpus also contains 84,000
  distinct hosts that aren't ranked at all, which is the tail past the top million.

### DuckDuckGo

Asked for, and not used. Its `html.` and `lite.` endpoints answer scripted requests
with a bot-detection challenge (HTTP 202 and an "anomaly" page); getting around that
means defeating an anti-abuse control. Its public API is the Instant Answer API, which
returns encyclopaedia summaries and `duckduckgo.com` disambiguation links rather than
web results — a few dozen usable URLs per thousand requests. There is no supported way
to get a result feed out of it.

The sources in `tools/sources.js` are the ones that publish an API for this and
paginate deeply enough to matter. Reddit blocks scripted access too (403 on both the
JSON and RSS endpoints), and Common Crawl and the Wayback Machine are unreachable from
this environment. GDELT and Stack Exchange are implemented and reachable but left out
of the default mix: both rate-limit hard enough to cost minutes for a rounding error's
worth of corpus. Use `--source` if you want them.

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

**Code execution.** `expand()` guarantees its result has a scheme in `ENCODABLE` and
throws `ClentError` otherwise. A fragment is entirely attacker-controlled, so this is
the contract that makes auto-redirecting safe at all. `javascript:`, `data:`,
`vbscript:`, `blob:` and `file:` are refused when encoding and when decoding, including
through the verbatim path. Every one- and two-character payload is swept exhaustively
in the tests to prove no header byte can produce anything else.

**Deception.** The allowlist stops a payload running code; it does nothing about a
payload that points somewhere deliberately misleading, which is the likelier abuse of a
redirector — the link wears this site's domain, and the destination is invisible until
it has already happened. `assess()` looks for the shapes phishing links take and the
page stops instead of following:

| | |
| --- | --- |
| `https://paypal.com@evil.example/` | the part before the `@` is not the destination |
| `https://xn--pypal-4ve.example/` | punycode that renders as a familiar name |
| `https://192.0.2.10/admin` | a raw IP rather than a named site |
| non-standard port, plain `http:` | shown as a note, still followed |

None of this is a verdict on whether a site is malicious — that can't be known from a
URL. These are properties an ordinary shared link almost never has.

**The page itself.** The built page ships a Content-Security-Policy that names its own
script and style by SHA-256 hash and forbids everything else: `default-src 'none'`, no
network of any kind, no form submission, no `<base>` rewriting. An injected script would
have the wrong hash and not run. `frame-ancestors` is *not* set, because a meta tag
cannot set it and GitHub Pages cannot send headers — clickjacking protection is the one
control not available here.

**Privacy.** No cookies, no storage, no analytics, and one network request, for the page
itself — all asserted in the browser tests rather than claimed. `Referrer-Policy:
no-referrer` means the destination isn't told where you came from. The fragment never
leaves the browser, so no server ever learns the destination.

**Degenerate input.** Hard edges everywhere, each a `ClentError` with a user-showable
message: URLs over 8,192 characters are refused, payloads over 16,384, and — the one
that matters — decompression is bounded at 16 KB. Before that bound, a 27,000-character
fragment inflated to a 20 MB string on the main thread before validation saw it; now a
decompression bomb is cancelled while it is still small, which the tests prove with a
real one.

Append `~` to a link to preview where it goes instead of going there.

## How the encoding works

1. **Tracking parameters are removed** — `utm_*`, `fbclid`, `gclid` and similar. Worth
   about 25% of the payload on a link that has them. It's the only step that changes
   the destination, so it's a switch rather than a default.
2. **Known URL shapes collapse to an ID.**  90 templates cover YouTube, Amazon,
   imgur, X, Facebook, Instagram, Reddit, TikTok, GitHub, Spotify, eBay, Etsy, arXiv
   and others. `youtube.com/watch?v=dQw4w9WgXcQ` is 43 characters carrying 11 of
   information; templated it is 15. Each slot is encoded at its own alphabet's width —
   a YouTube ID is Base64url so 6 bits a character, an Amazon ASIN is uppercase and
   digits so also 6, a numeric status ID is 4 — where the general text encoder would
   spend up to 12 a character on capitals.

   A template is used **only if** substituting the captured values back into the
   pattern reproduces the URL exactly. A near miss falls back rather than guessing;
   getting this wrong would mean a link that silently resolves somewhere else.
3. **The predictable parts become bits.** Scheme, `www.` and a trailing slash cost 12
   characters in a normal URL; here they're 3 bits in a 6-bit header. Non-http schemes
   go through a 15-entry scheme table at 4 bits each, so `mailto:` and `tel:` links are
   first-class instead of paying for their scheme in the body.
4. **253 common hosts collapse to one byte.** Shopping, news, social and image hosts
   included, chosen by category rather than mined — corpus frequency measures what
   Wikipedia cites, not what people shorten.
5. **Every other domain stays cheap without a dictionary entry.** The hostname gets
   its own Huffman code whose *terminal* symbols are registrable suffixes — `.com`,
   `.org`, `.co.uk`, `.github.io`, 128 of them mined across distinct names
   (`src/hostcode.js`, `tools/mine-host.mjs`). `.com` — the ending of two in five
   unknown hosts — costs a couple of bits instead of four spelled characters, and a
   host whose ending isn't listed just ends with the plain END symbol. Nothing about
   this needs updating when someone shortens a domain nobody has seen before.
6. **The rest is encoded every way it legally can be, and the shortest is kept:**
   - **text** is canonical-Huffman-coded: every byte costs what its measured
     frequency in real URLs earns it — `/` and `e` under 5 bits, capitals their own
     longer codes, unknown bytes an escape — and every entry of a 256-token
     substring dictionary (`articles/`, `index.php`, `.jpg`…) is **its own
     symbol in the same code**, so a frequent token costs a handful of bits and
     a rare one pays its own way; no fixed index tax. Tokens must span at least
     25 *distinct hosts* to be mined, so the dictionary generalises instead of
     memorising one site's paths. The tables live in `src/textcode.js`, mined
     from the corpus by `tools/mine-text.mjs`.
   - **raw** is plain 8-bit bytes, the fallback for byte soup.
   - **deflate** wins once a URL is long or repetitive enough to repay its overhead.

On the corpus: host wins 78.1%, text 15.8%, templates 5.7%, deflate 0.3%, raw 0.1%.

## Tamper resistance

Two things, with different strengths, and the difference matters.

**Integrity check** (four characters, on by default). A truncated SHA-256 of the
payload. Catches a link that was clipped by a chat client, mangled, or edited. It has
no key, so anyone can recompute it — **it catches accidents, not attackers**, and is
never described as more than that. Verified before the destination is shown, let alone
followed.

**Signature** (18 characters, opt-in). HMAC-SHA-256 under a passphrase. Proves the link
was made by someone who knows the passphrase. Also:

- It doesn't identify a person — everyone with the passphrase can sign.
- It doesn't stop anyone stripping it; a forger hands over an unsigned link instead,
  which is why the page shows signed and unsigned links differently.
- It's useless if the passphrase is public.

Public-key signatures would fix the identity problem. The smallest useful one is 64
bytes — 86 characters — on a payload averaging 30, so it would *be* the link. The short
option was chosen and the trade written down rather than hidden.

The tag rides after the payload, `#<payload>.c<tag>` or `#<payload>.h<tag>`, so it never
changes where the link goes and stripping it leaves a working link.

### On removing `ref`

Asked for, and it can't be done globally. Measured over the corpus, `ref=` appears on
0.05% of URLs and the values are overwhelmingly *data*: `Luuk.+23:26-49`, `Matt.+6:1`,
`495-99-8` (a CAS registry number), `pdf_download`, page numbers. Stripping it
everywhere would break those links to save a few characters on the sites where it is
tracking.

So it's removed by host — Amazon, eBay, Etsy, Reddit, Temu, Shein, Wayfair, IKEA, ASOS,
Substack, TikTok, Pinterest, Booking and others — along with the rest of their
site-specific tracking. `?ref=Matt.+6:1` on a Bible site survives; `?ref=sr_1_3` on
Amazon does not.

### Wire format v1

```
6 bits   header   bits 0-1  scheme: 0 = https://, 1 = http://, 2 = other,
                                    3 = template
                  bit  2    "www." was stripped
                  bit  3    host came from the dictionary
                  bits 4-5  body mode: 0 = text, 1 = raw, 2 = deflate,
                                       3 = host
8 bits   host     dictionary index — only when bit 3 is set
body     text     canonical-Huffman symbols (table in src/textcode.js):
                  literal bytes, TOKEN + 7-bit index into 128 mined
                  substrings, ESC + raw byte, END
         raw      UTF-8 bytes, 8 bits each
         deflate  DEFLATE-raw bytes, 8 bits each
         host     the hostname in its own code (table in src/hostcode.js):
                  name characters, then one terminal symbol that both
                  appends a registrable suffix (".com", ".co.uk",
                  ".github.io" — 128 of them) and ends the field; the tail
                  follows as text

under scheme 2 ("other"): bits 2-3 must be zero, the mode must not be 3,
         then a 4-bit index into the scheme table — mailto:, ftp:, tel: and
         the rest cost 4 bits instead of being spelled out. Index 15 is
         reserved: the scheme is spelled in the body, so future tables can
         carry schemes this one has never heard of. URLs with
         user:password@ ride this path too, and don't pay 8 characters for
         "https://".

under scheme 3: 8 bits of template index, then each slot as 6 bits of length
         followed by its characters at the slot alphabet's own width
         (4 bits for digits, 6 for Base64url)

optional tag, outside the payload:
         #<payload>.c<tag>   keyless integrity check
         #<payload>.h<tag>   HMAC under a passphrase
```

The body is the tail (`/path?query#frag`) when the host rides the dictionary
or its own field, `host + tail` when it is spelled into the text, or
everything after the scheme under scheme 2.

Two details that are load-bearing:

- The tail comes from `url.href`, not `pathname + search + hash` — the latter drops a
  trailing empty `?` or `#`, which changes the destination. Caught by fuzzing.
- URLs with `user:password@` are always stored under scheme 2. The compact forms have
  nowhere to keep userinfo and dropping it would repoint the link.

**Compatibility stance (beta):** while the beta runs, re-mining may replace the
Huffman tables and invalidate earlier links — compression wins over compatibility,
deliberately. The machinery for the stable era is already in place: indexed tables
(`HOSTS`, `TEMPLATES`, schemes) grow append-only and the template index chains past
255 so the table is unbounded; a reserved leading header (`VERSION_ESCAPE`) gives
future wire formats their own envelope; and `test/compat.test.js` pins golden
payloads plus table hashes. Declaring 1.0 means freezing that file — after that, a
link made on any day decodes forever.

## Project layout

```
src/clent.js      codec core and public API — one import serves everything
src/bits.js       bit stream + ClentError
src/huffman.js    canonical Huffman machinery, shared by both codes
src/text.js       Huffman text mode, token DP, strict decoder
src/textcode.js   its mined code + tokens   (data, append-only)
src/host.js       the host field: suffix-terminal code for any domain
src/hostcode.js   its mined code + suffixes (data, append-only)
src/qr.js         dependency-free QR encoder (byte mode, EC M, v1-11)
src/sw.js         service worker: the page works offline after one visit
src/manifest.webmanifest, src/icon.svg   installable-app plumbing
src/deflate.js    bounded DEFLATE (16 KB inflate cap)
src/tracking.js   tracking-parameter policy
src/risk.js       phishing-shape assessment
src/schemes.js    scheme table          (data, append-only)
src/hosts.js      host dictionary       (data, append-only)
src/templates.js  known URL shapes      (data, append-only)
src/sign.js       integrity checks and signatures
src/*.d.ts        types, one per module, pinned by test/exports.test.js
src/index.html    the page
src/app.js        the two views: link maker and redirector
src/style.css

test/             134 tests on node:test
  bits            bit stream round-trips at every width
  codec           encoding, edge cases, mode and token selection
  schemes         the scheme table, reserved indices, escape hatch
  host            the host field, suffix terminals, refused flag combos
  security        hostile fragments, scheme allowlists, exhaustive sweeps
  robustness      size caps, decompression bombs, unassigned symbols
  property        generated URLs, truncation, bit-flips, random payloads
  templates       shape matching, near-miss safety
  sign            checksums, signatures, tamper detection
  tables          data-table wire invariants in one place
  exports         .d.ts vs runtime export parity, both directions
  qr              matrices vs a reference implementation, capacity edges
  corpus          the real-URL corpus, one shared scan
  optimality      brute-force check that no smaller encoding existed
  minify          that the minified library computes what the source computes
  readme          this file's quoted numbers against corpus/stats.json

tools/            fetch-corpus, sources, corpus, validate-corpus, coverage,
                  optimality, mine-text, mine-host, bundle, minify, build,
                  serve, browser-test
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

Push to `main`. The workflow runs the full gate — tests, types, a browser pass
against the built site — then publishes `dist/`; set **Settings → Pages →
Source** to **GitHub Actions** once, by hand.

`dist/404.html` is a copy of the app, so a mistyped path still resolves its fragment.

**Custom domain (`nul.im`):** the build emits `dist/CNAME` from the measured
origin in `corpus/stats.json`, so Pages picks the domain up automatically. Two
one-time steps remain at the registrar and on GitHub:

1. DNS: apex `A` records for `nul.im` → `185.199.108.153`, `185.199.109.153`,
   `185.199.110.153`, `185.199.111.153` (and optionally `AAAA` →
   `2606:50c0:8000::153` … `:8003::153`), or an `ALIAS`/`ANAME` to
   `jar99.github.io` if the registrar supports it.
2. Repo **Settings → Pages**: set the custom domain to `nul.im` and tick
   **Enforce HTTPS** once the certificate is issued.

### Running behind Cloudflare

`nul.im` is proxied through Cloudflare. Three settings matter; two of them can
silently break the page:

1. **SSL/TLS mode: Full (strict)** — or Full if GitHub hasn't issued the
   domain certificate yet. *Flexible* causes redirect loops with GitHub Pages.
2. **Anything that rewrites HTML must stay off**: Rocket Loader, Email
   Obfuscation, Mirage, and any minification/injection app. The page's CSP
   pins its inline scripts by hash — a proxy that edits or injects a single
   byte of script makes the page refuse to run itself. (This is a feature:
   the same pin is what stops anyone else injecting script.)
3. **Caching**: a Cache Rule for `nul.im/*` with "Cache eligible" and an edge
   TTL of an hour or more serves the page from Cloudflare's edge worldwide.
   GitHub Pages only sends `max-age=600`; the rule lifts that at the edge.
   Deploys still propagate within the TTL, and returning visitors don't
   touch the network at all — the service worker has the page already.

### Analytics without tracking

The measurement this project will accept: aggregate counts nobody can be
identified from, collected without touching the page.

- **Cloudflare's proxy analytics** (dashboard → Analytics) already counts
  requests, visitors, countries and status codes server-side — no script, no
  cookie, no page change. Crucially it can never see where any link goes:
  destinations live in the URL fragment, and browsers do not send fragments
  in requests. Cloudflare sees that someone opened `nul.im`, never what the
  link pointed at.
- **Google Search Console** reports search impressions and clicks on its own
  data. Submit the sitemap once: Search Console → Sitemaps →
  `https://nul.im/sitemap.xml`.
- **The line not crossed**: no analytics JavaScript — not even the
  "privacy-friendly" kind. A beacon would be the page's first third-party
  request, the CSP forbids it (`connect-src 'none'`), and the README's
  premise is that nothing observes the people using it. If deeper insight is
  ever wanted, it comes from Cloudflare's edge, never from the visitor's
  browser.

**Deploying a fork on a different domain:** the links themselves adapt
automatically — the prefix comes from `location` at runtime. Only the *prose*
quoting break-even lengths is baked from `corpus/stats.json`, which was measured
against this repository's 40-character address. To make those numbers true for
your domain, re-measure and commit:

```sh
node tools/validate-corpus.mjs --origin https://your.domain/path/#
git add corpus/stats.json && git commit -m "Re-measure for our origin"
```

## Loading, no-JS and mobile

The page is a redirector, so the gap between a click and knowing where to go is the
whole experience. Three things follow from that:

- **The script sits in `<head>` as a classic inline script, not a module.** Module
  scripts are always deferred, so a redirect would wait for the entire document to
  parse first. As a plain inline script it runs during head parsing, and the redirect
  fires before the body exists. Anything needing the DOM goes through a `whenReady()`
  helper instead.
- **The view switch is CSS**, driven by an attribute set before first paint, so someone
  who merely clicked a link never sees the creator UI flash past.
- **One request.** Everything is inlined, so there is no second round trip.
- **After the first visit, no requests at all.** A service worker caches the
  page (cache-first, refreshed in the background, rotated per deploy by build
  hash), so the site loads and links decode with no connection whatsoever —
  the destination is inside the fragment, so nothing else was ever fetched.
  The page also installs as a lightweight app via a web manifest; the icon is
  SVG, which Chromium-family browsers use for install (Safari falls back to
  its screenshot behaviour — a deliberate trade against shipping a raster
  pipeline).

Without JavaScript the explanatory content reads normally and a `<noscript>` block says
plainly that the box won't work and why. Following a Clent link genuinely requires
JavaScript: the destination is inside the fragment, browsers never send fragments to
servers, and there is no database holding a copy — so there is nothing that could
resolve it server-side. That is the cost of the design, not an oversight.

On mobile: inputs are 16px so iOS doesn't zoom on focus, tap targets are at least 32px,
`env(safe-area-inset-*)` keeps content clear of notches, and the browser tests assert
no horizontal overflow at 320, 360, 390, 414, 768 and 1024 pixels.

## Browser support

Needs `CompressionStream`/`DecompressionStream` with `deflate-raw` for the deflate
mode — Chrome 103+, Firefox 113+, Safari 16.4+. Without it, links still work; deflate
just isn't offered as a candidate, which costs about 1% of links some length.

## Licence

MIT.
