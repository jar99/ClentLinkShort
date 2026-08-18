# Clent

A privacy-focused, open-source link shortener, live at **[nul.im](https://nul.im)**.
No database, no backend, no accounts — the whole URL is compressed into the link
itself, so there is nothing to store and nothing that can stop working later. Any host
logs that a page was served, the way every web server does; no log anywhere can contain
a destination, because destinations never travel in a request.
MIT-licensed; fork it and it runs on any static host.

```
https://nul.im/#F8oJgxOaSY3d9ZKAA
               └── the destination is in here
```

The payload sits in the fragment, which browsers don't send to servers. No server
sees where anyone is going.

```sh
npm test              # 169 tests, no dependencies
npm run dev           # serve src/ as real ES modules
npm run build         # one self-contained file in dist/
npm run corpus:get    # fetch the corpus (a release asset, not committed)
npm run validate      # round-trip the whole corpus
npm run coverage      # how much of the ranked web the corpus reaches
```

## Is it actually shorter?

More often than before, and the numbers are measured, not hoped.

The encoded destination is **51% of the URL it came from** (median). Every link also
carries the site's address — 16 characters on `nul.im` — so a URL only has to be
longer than about **20 characters** before the whole link comes out shorter. That is
most links people actually share: **84% of deep links** (anything past a bare
homepage) shrink, and popular shapes do far better still — a timestamped YouTube
share is 49 characters in, 17 out.

Measured over 4,325,469 real URLs:

| Prefix | Break-even URL length | Links that come out shorter |
| --- | --- | --- |
| `nul.im/#` (16c) | ~20 | 63.2% |
| a github.io project page (40c) | ~105 | 5.9% |
| payload alone, no prefix | ~10 | 99.7% |

Bare homepages (26% of the corpus) are the one shape that rarely wins — there is
nothing to compress away. What you get regardless of length is a link nothing is
storing, that can't be revoked or logged, and that still resolves when whoever made
it has forgotten about it.

## Compared to ha.mr

[ha.mr](https://github.com/p2r3/ha.mr) is the other static URL compressor — bit-level
canonicalisation, a Huffman-coded domain dictionary, Huffman text. Running its actual
encoder head-to-head over a representative 3,538-URL corpus sample:

| | Clent | ha.mr |
| --- | --- | --- |
| Total payload, same 3,538 URLs | **108,903 chars** | 119,333 chars |
| Decodes back byte-identical | **100%** | 84.7% |
| Output alphabet | 64 chars, Base64url | 84 chars incl. `[ ] ' ( ) , ;` |
| `watch?v=…&t=36s` (its own demo) | **17** | 27 |
| `zelda.fandom.com/wiki/Ice_Queen` | **16** | 25 |
| Shorter link, per URL | **54.6%** | 35.9% |

Clent wins the per-URL split outright now, with a 64-character safe alphabet against
their 84 — characters like `[](),'` are exactly the ones chat apps cut links off at,
which is why Clent's default refuses them. (The opt-in dense style plays the same
alphabet game, base 87, while keeping the safe Base64url form the default and the
canonical one.) Its 15.3% of non-identical decodes are lossy canonicalisation (dropped trailing
slashes, `%28` decoded to `(`, case changes): usually harmless, sometimes a different
page. Clent holds byte-exactness at 100% across the full 4,325,469 and fails loudly
otherwise. On security, the comparison is one-sided: scheme allowlisting on encode and
decode, phishing-shape interception, hash-pinned CSP, integrity tags and signing, and
bounded decompression are all Clent-only.

## Validation

`corpus/` holds 4,325,469 real URLs from seventeen sources, weighted towards the
kinds of link people actually share — collected by `npm run corpus:update`, which
merges, checkpoints every two minutes, and can be re-run any time to grow the set
without ever invalidating a link:

| Source | What it contributes |
| --- | --- |
| Wikipedia, 40 language editions | citations — messy, old, heavily percent-encoded |
| Wikipedia per-domain mining | cited IMDb, LinkedIn, Instagram, X deep links |
| Tranco top 1M | ranked domains, head-weighted |
| Hacker News stories + comments | submitted links, and links shared in conversation |
| Reddit listing feeds | submitted destinations and permalinks |
| Mastodon, 16 instances | posts, link cards, body links |
| Lemmy, 8 instances | social posts: news, deals, images |
| 83 Fandom wikis | real article URLs — capitals, quotes, parentheses |
| Google News, 6 locales | share URLs and source articles |
| Crossref | DOI links, capped at 200k |
| npm + PyPI registries | package pages, capped at 200k each |
| Internet Archive | item pages across five media types |
| Wikimedia Commons | image URLs on a CDN host |
| 50 RSS/Atom feeds | news, deals, newsletters, YouTube channels |

| | |
| --- | --- |
| URLs round-tripped | **4,325,469** |
| Decoded to the byte-identical original | **100%**, 0 failures |
| Encoded worse than an available alternative | **0** |
| Payload vs input URL | **57.2%** overall, median **50.9%** |
| Payload shorter than input | **99.7%** |
| Host dictionary hit rate | **22.9%** |
| Carried tracking parameters | **2.2%**, worth 25% of the payload on those |
| Winning body mode | host 59.1%, text 24.3%, template 16.2%, deflate 0.4%, raw 0.0% |

The corpus is **not** in the repository. It is 66 MB of brotli, and brotli does not
delta-compress, so committing each snapshot added its whole size to every future clone
— four snapshots had already put 144 MB of blobs in a 158 MB `.git`. It lives as a
release asset instead:

```sh
npm run corpus:get      # download and verify; no-op once it is present
```

`corpus/manifest.json` names the snapshot and carries two hashes — one over the
decompressed corpus, which is its identity, and one over the compressed bytes, so a
download is checked without inflating 238 MB first. A truncated or swapped file fails
there rather than quietly changing what "validated" means, and the file is only put in
place once the hash matches. CI fetches it the same way, so the numbers below are still
measured against a specific, named corpus rather than whatever happened to be on disk.

Publishing a new snapshot is the **Publish corpus** workflow, which verifies the
manifest before uploading. (Clones made before this change still carry the old blobs in
their history; shrinking that needs a history rewrite, which is a separate and
deliberately disruptive step.)

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
  | top 1,000,000 | 99.2% |

  Traffic-weighted reach at Zipf *s*=1: **99.9%**. The corpus also contains 217,995
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
| `https://paypal.com.evil.example/` | a brand worn as a subdomain of somewhere else |
| `https://xn--pypal-4ve.example/` | a name mixing alphabets so letters can pose as others |
| `https://192.0.2.10/admin` | a raw IP rather than a named site |
| non-standard port, plain `http:` | shown as a note, still followed |

None of this is a verdict on whether a site is malicious — that can't be known from a
URL. These are properties an ordinary shared link almost never has.

The brand check is the one with a false-positive cost, so it was measured rather than
assumed: across the whole 4,325,469-URL corpus it fires on five links, all of the form
`brand.com.<cdn>` (Akamai's `edgesuite.net` and `edgekey.net`, Coral's `nyud.net`) —
which is the shape it describes, operated by someone benign. One interstitial per
million links, and the reader can still continue, is the right side of that trade.
It matches whole labels, so `notpaypal.com.au` is not a hit, and it understands a
registry tail, so `google.com.au` and `apple.com.cn` are their owners' own sites.

Internationalised names are opened like any other, because they are valid, safe URLs:
refusing every `xn--` name would support the Latin web rather than the web. `src/idn.js`
decodes the name and counts the scripts it draws on, so a Cyrillic, Japanese, Chinese or
emoji domain passes untouched and only a label that *mixes* scripts — the Cyrillic `а`
hiding in `pаypal` — is treated as deceptive. Combinations real languages need (Japanese
Han with kana, Korean Han with Hangul) are not mixing. Measured: all 1,539
internationalised URLs in the corpus pass, and none is flagged.

The limit, stated plainly: a whole-script confusable — every character Cyrillic, still
reading as "paypal" — is not mixed, so this does not catch it. That needs a confusables
table far larger than this page, and it is a different problem from the one this solves.

**The page itself.** The built page ships a Content-Security-Policy that names its own
script and style by SHA-256 hash and forbids everything else: `default-src 'none'`, no
network of any kind, no form submission, no `<base>` rewriting. An injected script would
have the wrong hash and not run. `require-trusted-types-for 'script'` closes the DOM
injection sinks too — one named policy may mint the service worker's URL and nothing
else may mint anything.

One caveat the policy cannot cover: a service worker runs under *its own* response
headers, not the document's, so `dist/sw.js` is outside the hash pin. It is same-origin,
refuses every cross-origin request, and registers no message handlers — but it is the
one piece of shipped code the CSP does not constrain, which is worth knowing rather than
discovering.

**Clickjacking.** `frame-ancestors` is *not* in the policy, because browsers ignore it in
a meta tag; it has to arrive as a real header. The page therefore refuses to run framed
on its own — the pre-paint script swaps the whole document for a "can't run in a frame"
notice, so a transparent overlay has nothing to aim a click at. That works on any static
host, which is the point: it needs no cooperation from whatever is serving the files.

If you *can* set response headers — most static hosts and every reverse proxy can, and
GitHub Pages on its own cannot — set these as well. They are worth having whoever serves
the page:

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | `frame-ancestors 'none'` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |

Two CSPs — the header and the page's own meta tag — are enforced *together*, each in
full, so a header carrying only `frame-ancestors` adds clickjacking protection without
weakening any of the hash pinning above. Where they go depends on the host: a `_headers`
file (Netlify, Cloudflare Pages), `add_header` in an nginx `server` block, a `header`
directive in a Caddyfile, a response-header transform rule on a CDN. None of that is
this project's business — it ships a page that is safe without them and better with
them.

**Privacy.** No cookies, no `localStorage`, no `sessionStorage`, no analytics — asserted
in the browser tests rather than claimed. Decoding a link takes exactly **one** request,
for the document itself; the service worker and the four files it precaches load
afterwards and never block a redirect, which the tests now count on the browser context
rather than the page, so a regression is visible. `Referrer-Policy: no-referrer` — set as
a meta tag, so it holds even where response headers are not available — means the
destination isn't told where you came from.

The page does write to Cache Storage — that is what makes it work offline. It holds the
app itself and provably cannot hold a destination: fragments are excluded from a request
URL, so no cache key can carry one. The tests read every cached entry back and check
exactly that.

**Degenerate input.** Hard edges everywhere, each a `ClentError` with a user-showable
message: URLs over 8,192 characters are refused, payloads over 16,384, and — the one
that matters — decompression is bounded at 16 KB. Before that bound, a 27,000-character
fragment inflated to a 20 MB string on the main thread before validation saw it; now a
decompression bomb is cancelled while it is still small, which the tests prove with a
real one.

Append `~` to a link to preview where it goes instead of going there.

**Link styles.** The canonical payload is Base64url — the only alphabet that survives
every chat app, terminal and clipboard, and the form all integrity tags are computed
over. Two opt-in dresses re-spell the same bits: **dense** writes the payload in
base 87 over every character a browser keeps verbatim in a fragment — about 7% fewer
characters at the cost of punctuation some apps cut links at, and never longer than
canonical: the punctuation itself identifies the dress, so the `~` marker is paid
only in the rare payload that happens to spell itself in Base64url characters.
**Emoji** packs 8 bits a glyph into the animal block, a quarter fewer characters to
look at. Both are exact re-encodings — the same tag verifies the link in any
spelling.

## How the encoding works

1. **Tracking parameters are removed** — `utm_*`, `fbclid`, `gclid` and similar. Worth
   about 25% of the payload on a link that has them. It's the only step that changes
   the destination, so it's a switch rather than a default.
2. **Known URL shapes collapse to an ID.**  258 templates cover YouTube, Amazon,
   imgur, X, Facebook, Instagram, Reddit, TikTok, GitHub, Spotify, eBay, Etsy, arXiv,
   Google Docs and Drive, Discord and WhatsApp invites, the big shorteners (bit.ly,
   tinyurl, t.co), the news sites' date-and-slug shapes, Steam, IMDb, Wikipedia in
   ten languages, the Stack Exchange network and others. `youtube.com/watch?v=dQw4w9WgXcQ` is 43 characters carrying 11 of
   information; templated it is 14. Each slot travels as one integer in its own
   alphabet's base, so a character costs exactly what its alphabet needs —
   a YouTube ID is Base64url so 6 bits a character, an Amazon ASIN base 36 so 5.17,
   a numeric status ID 3.33 — where the general text encoder would spend up to 12 a
   character on capitals. The template table is ordered by measured use, so the
   most-shared shapes spend 3 bits on their index and the rarest 11.

   A template is used **only if** substituting the captured values back into the
   pattern reproduces the URL exactly. A near miss falls back rather than guessing;
   getting this wrong would mean a link that silently resolves somewhere else.
3. **The predictable parts become bits.** Scheme, `www.` and a trailing slash cost 12
   characters in a normal URL; here they ride inside one Huffman-coded header symbol
   whose common shapes cost 2-3 bits — the header's measured entropy, not a flat
   field. Non-http schemes go through a 15-entry scheme table at 4 bits each, so
   `mailto:` and `tel:` links are first-class instead of paying for their scheme in
   the body.
   One template can carry a whole platform: a template's host may hold a slot —
   `{0}.fandom.com/wiki/{1}`, `{0}.substack.com/p/{1}` — so every community wiki,
   newsletter, blogspot, tumblr and github.io page rides one table entry. Not a wire
   feature: a host slot is a slot like any other, and the reproduce-exactly guard
   still decides every match.
4. **512 common hosts collapse to an index.** Shopping, news, social and image hosts
   included; the dictionary is ordered by measured use, so the most-shortened hosts
   cost 3 bits and the rest 11-19 — and the table can grow without a format change.
5. **Every other domain stays cheap without a dictionary entry.** The hostname gets
   its own Huffman code whose *terminal* symbols are registrable suffixes — `.com`,
   `.org`, `.co.uk`, `.github.io`, 160 of them mined across distinct names
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

On the corpus: host wins 59.1%, text 24.3%, templates 16.2%, deflate 0.4%, raw 0.0%.

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
header   one canonical-Huffman symbol over the 64 header values — the
         measured header entropy is 2.6 bits, so the common shapes cost
         2-3 bits and rare-but-legal ones up to 12. The value's bits:
                  bits 0-1  scheme: 0 = https://, 1 = http://, 2 = other,
                                    3 = template
                  bit  2    "www." was stripped
                  bit  3    host came from the dictionary
                  bits 4-5  body mode: 0 = text, 1 = raw, 2 = deflate,
                                       3 = host
index    host     dictionary index — only when bit 3 is set. Escape-coded:
                  3 bits for the seven most-shortened hosts, 11 for the
                  rest, open-ended past the table's current end
body     text     canonical-Huffman symbols (table in src/textcode.js):
                  literal bytes, 256 mined substrings as symbols of their
                  own, ESC + raw byte, END
         raw      UTF-8 bytes, 8 bits each
         deflate  DEFLATE-raw bytes, 8 bits each
         host     the hostname in its own code (table in src/hostcode.js):
                  name characters, 64 mined fragments ("blog.", "mail."),
                  then one terminal symbol that both appends a registrable
                  suffix (".com", ".co.uk", ".github.io" — 160 of them) and
                  ends the field; the tail follows as text

under scheme 2 ("other"): bits 2-3 must be zero, the mode must not be 3,
         then a 4-bit index into the scheme table — mailto:, ftp:, tel: and
         the rest cost 4 bits instead of being spelled out. Index 15 is
         reserved: the scheme is spelled in the body, so future tables can
         carry schemes this one has never heard of. URLs with
         user:password@ ride this path too, and don't pay 8 characters for
         "https://".

under scheme 3: an escape-coded template index (3 bits for the most-shared
         shapes, 11 for the rest), then each slot as 6 bits of length
         followed by the whole value as one integer in the slot alphabet's
         base — exactly ceil(len·log2 N) bits, so digits cost 3.33 a
         character and an ASIN 5.17

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

**Compatibility stance: frozen at 1.0.** Through the beta, re-mining was allowed to
replace the Huffman tables and invalidate earlier links — compression won over
compatibility, deliberately, and it is why the payloads are the size they are. That
licence is now spent. `test/compat.test.js` pins every frozen table by hash along with
golden payloads, and it is no longer regenerated: a failure there means a change would
break links that already exist, and the change is what gives.

What can still move: `HOSTS`, `TEMPLATES` and the scheme table grow append-only past
their pinned prefixes, and the escape-coded index chains past 255, so the tables are
unbounded — new sites can be covered without touching a single existing encoding. What
cannot move: the five Huffman tables, including the header code that every payload
begins with. A future format that wants different ones gets its own envelope through
`VERSION_ESCAPE` rather than renumbering this one.

A link made on any day from here decodes forever.

## What this does not protect against

The privacy claim is narrow and worth stating exactly: **nothing in this system ever
learns a destination**, because destinations ride in the fragment and fragments are not
part of an HTTP request. That is airtight for the parts this project controls. It says
nothing about what happens to a link once it is out in the world, and a few of those
paths are worth knowing.

- **URL-rewriting scanners.** Microsoft Defender Safe Links, Proofpoint, Mimecast and
  similar rewrite links in email and chat into `https://scanner.example/?url=<the whole
  original URL>` — fragment included. Send a Clent link through corporate mail and that
  vendor has the destination in plaintext. This is the most common way the promise
  breaks in practice, and nothing client-side can prevent it.
- **Browser and OS sync.** The fragment is part of the URL, so the destination lands in
  browser history — and with Chrome or Firefox Sync on, that history is uploaded.
  Copying a link puts the destination on the clipboard, which Windows Cloud Clipboard
  and Apple Universal Clipboard also sync off-device.
- **The address bar.** Typing or pasting a Clent link into the omnibox can send it to
  the default search engine's suggestion endpoint before it is ever loaded.
- **Whoever serves the page.** A host that terminates TLS can rewrite the page it
  serves, including its Content-Security-Policy. The hash pinning stops third parties
  from injecting script; it cannot stop the party doing the serving. Self-host if that
  matters to you — the whole point of a static build is that you can.
- **The link's recipient.** Anyone holding the link holds the destination. That is what
  a link is. There is no revocation, because there is nothing stored to revoke.

**Integrity tags are not a defence against a determined attacker.** The tag travels in
the link, so someone rewriting a link in transit simply removes it and substitutes a
destination; the recipient sees an ordinary untagged link, because an absent tag looks
exactly like a link that never had one. Tags catch clipping and corruption, and a
signature proves authorship to someone who already expects one — neither turns a link
into a channel you can trust against tampering.

**One thing that does work in your favour, though it is easy to miss.** There are no
per-link OpenGraph tags, deliberately. When a Clent link is pasted into Slack, Discord,
WhatsApp or anywhere else that unfurls links, the preview fetcher requests the page
*without* the fragment — so it renders a generic Clent card. The unfurler learns that a
Clent link was shared; it never learns where the link points. Conventional shorteners
resolve server-side and hand the destination to every preview bot that asks.

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
src/idn.js        punycode decoding; real IDN vs homograph
src/schemes.js    scheme table          (data, append-only)
src/hosts.js      host dictionary       (data, append-only)
src/templates.js  known URL shapes      (data, append-only)
src/sign.js       integrity checks and signatures
src/*.d.ts        types, one per module, pinned by test/exports.test.js
clent.config.js   origin, directories, assets, ports — what a fork edits
src/index.html    the page
src/app.js        the two views: link maker and redirector
src/style.css

test/             169 tests on node:test
  bits            bit stream round-trips at every width
  codec           encoding, edge cases, mode and token selection
  schemes         the scheme table, reserved indices, escape hatch
  host            the host field, suffix terminals, refused flag combos
  security        hostile fragments, scheme allowlists, exhaustive sweeps
  robustness      size caps, decompression bombs, unassigned symbols
  property        generated URLs, truncation, bit-flips, random payloads
  templates       shape matching, near-miss safety
  transport       dense and emoji spellings, grammar collisions
  sign            checksums, signatures, tamper detection
  tables          data-table wire invariants, incl. host-slot charsets
  compat          golden payloads and table hashes: links decode forever
  exports         .d.ts vs runtime export parity, both directions
  qr              matrices vs a reference implementation, capacity edges
  corpus          the real-URL corpus, one shared scan
  realworld       links in the shapes people actually paste
  optimality      brute-force check that no smaller encoding existed
  contrast        every text colour against WCAG AA, both themes
  i18n            catalogue parity, placeholders, and that no key is missing
  minify          that the minified library computes what the source computes
  readme          this file's quoted numbers against corpus/stats.json

tools/            fetch-corpus, sources, corpus, validate-corpus, coverage,
                  optimality, mine-text, mine-host, mine-header,
                  mine-templates, mine-stamp, bundle, minify, build, serve,
                  browser-test
```

Mining reads millions of URLs to emit a few kilobytes of table, so the miners
refuse to do it twice for the same answer. Each one declares what its output
actually depends on — its own source, the shared sampler, whichever shipped
tables it consults, and its parameters — and hashes those together with the
corpus's own content hash. If that matches the stamp recorded in
`tools/mine-stamp.json` when the shipped table was written, the run is a no-op:
the sampler admits each URL by its own hash, so identical inputs give a
byte-identical table. `--force` mines regardless. The failure mode is
one-sided on purpose: declaring a dependency that does not matter costs a
needless re-mine, while missing one would let a stale table outlive a change
that should have moved it.

## Build and delivery

The page is a redirector, so the gap between a click and knowing where to go is the
whole experience. The build inlines the module graph, stylesheet and icon into one
file.

```
Source  ~214 kB across 23 files (over half of it the mined tables and templates)
Built   ~117 kB raw · ~37 kB gzip · ~32 kB brotli · 1 request on the critical path
```

"One request" is the document: everything the codec needs to resolve a link is
inlined, so a redirect never waits on a second round trip. The manifest and the
service worker load after that and block nothing.

The minifier is a tokeniser, not a pile of regexes: it tracks strings, template
literals with nested `${}`, regex literals and both comment forms, and keeps newlines
wherever removing one would change meaning through automatic semicolon insertion. It
does not rename identifiers.

It's verified rather than trusted. `test/minify.test.js` minifies the real library,
loads it, and asserts byte-identical payloads to the source.
`tools/browser-test.mjs` drives the built page in Chromium — 64 checks covering
redirects, preview mode, hostile fragments, that the creator UI never flashes during a
redirect, that the page refuses to run in a frame, that no cached entry can carry a
payload, and that decoding a link needs one request.

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
   the same pin is what stops anyone else injecting script.) **Bot Fight
   Mode** is the common offender: it injects an inline challenge script
   (`window.__CF$cv$params`) that the CSP blocks, which is harmless — the
   page runs fine and no visitor is affected — but it logs a CSP violation
   in every console and Cloudflare's bot scoring never runs. Turn Bot Fight
   Mode off to quiet it, or leave it; blocking a third party's injected
   script is exactly what the policy is for.
3. **Caching**: a Cache Rule for `nul.im/*` with "Cache eligible" and an edge
   TTL of an hour or more serves the page from Cloudflare's edge worldwide.
   GitHub Pages only sends `max-age=600`; the rule lifts that at the edge.
   Deploys still propagate within the TTL. This mattered more during the beta,
   when the tables could move and a stale copy of the page could misread a
   newer link; with the wire frozen at 1.0 an older page decodes today's links
   correctly. Returning visitors keep an offline fallback via the service
   worker, which prefers the network anyway.

Two things Cloudflare turns on by default are worth knowing about, because both make
the browser do something the page itself never asked for. Neither can carry a
destination — fragments are not in requests — but "the page makes no third-party
requests" is only true of the page:

- **Speed Brain** injects a `speculation-rules` header pointing at `/cdn-cgi/speculation`,
  which asks the browser to prefetch same-origin links. Harmless here; disable it under
  Speed → Optimization if you want the page's network behaviour to be exactly what the
  source says.
- **Network Error Logging** is advertised via `NEL` and `Report-To` headers pointing at
  `a.nel.cloudflare.com`, so browsers report failed requests to Cloudflare. Reports
  carry the request URL, which never includes the fragment.

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

**Configuring a fork.** `clent.config.js` holds the values a fork actually changes —
the site origin, the source and output directories, the assets copied beside the page,
and the ports the dev server and browser suite use. Every one has a working default, so
a clone builds unchanged; point `origin` somewhere else and the canonical link, OpenGraph
URL, sitemap, robots.txt, security.txt and CNAME all follow it.

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
- **Offline after the first visit.** A service worker caches the page
  (network-first with cache fallback, rotated per deploy by build hash), so
  the site loads and links decode with no connection whatsoever — the
  destination is inside the fragment, so nothing else was ever fetched.
  Network-first is deliberate: the page embeds the wire tables, and a cached
  copy from before a table change could misread a newer link. The 1.0 freeze
  removes that hazard for the tables themselves, but serving the current page
  when the network can answer is still the right default for everything else
  that ships in it.
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

## Language

The page picks its language from `navigator.languages` — the browser's own ordered
preference list — before anything is painted, so nothing is drawn in one language and
swapped in another. A picker in the footer overrides that for the session. Nothing is
persisted, because there is nowhere to persist it: the same reason there are no
cookies applies to the language too.

Catalogues are **bundled, not fetched**. The page is one file that has to work offline
under a CSP that forbids every network request, so a locale is a module rather than a
download. English is the fallback for any key a translation has not reached, which is
what makes a partial translation useful instead of a page full of holes — and if even
English lacks the key, `t()` returns the key itself, because a visible `m.copy` is a
bug report and an empty element is not.

The cost is honest: adding Spanish took the built page from ~30.8 kB to ~32.0 kB
brotli. Every further language is paid by every visitor, in every language, so this is
a real budget rather than a free feature.

### Adding a language

1. Copy `src/messages/en.js` to `src/messages/<code>.js` and translate the values.
   The export must be named `MESSAGES_<CODE>` — the build concatenates every module
   into one scope, and two catalogues both exporting `MESSAGES` would collide.
2. Import it in `src/i18n.js` and add it to `CATALOGUES`.

That is the whole change; nothing else in the app knows how many languages exist. The
picker appears only when there are at least two, so a fork that ships one language
gets no dropdown with one entry in it.

`test/i18n.test.js` enforces what makes this safe rather than merely present: every
catalogue answers for exactly the English key set, every catalogue file is registered,
every `{placeholder}` survives translation, every key `src/app.js` and `src/index.html`
actually ask for exists, and every risk code `src/risk.js` can emit is translatable.
The browser tests then check the live behaviour — that a Spanish browser gets a Spanish
page untouched, that a language nothing is translated into lands on English rather than
on raw keys, and that `<html lang>` and `dir` follow the choice.

### What is not translated

The long explanation below the tool, and this README. Translating an essay is a writing
job, not a wiring job, and a machine translation of a security warning is worse than an
English one someone has to work at. What *is* translated is everything functional: the
redirect view, every warning and failure, and every control in the maker.

Right-to-left languages set `dir="rtl"` on the document, and the layout is built to
survive it: every direction-dependent rule in `src/style.css` is a logical property
(`padding-inline-start`, `inset-inline-start`, `text-align: start`) rather than a
physical one. The single exception is the body's safe-area padding, which is physical
on purpose — a notch is on a side of the device and does not move with the text.

That is enforced rather than intended. `test/i18n.test.js` fails on any physical
direction property that creeps back in, and the browser tests flip the document to
`dir="rtl"` and assert the page still lays out with no horizontal overflow and its
absolutely-positioned markers still on the leading side. No RTL catalogue ships yet,
so the layout is exercised and the *translation* is not — adding one is the two steps
above and nothing more.

## Browser support

Needs `CompressionStream`/`DecompressionStream` with `deflate-raw` for the deflate
mode — Chrome 103+, Firefox 113+, Safari 16.4+. Without it, links still work; deflate
just isn't offered as a candidate, which costs about 1% of links some length.

## Licence

MIT.
