# Clent

A link shortener that runs entirely as a static GitHub Page and **stores nothing**.

There is no database, no backend, no accounts, no logging. The destination URL is
compressed and packed *into* the short link itself, so a link is its own record:
it can't expire, can't be lost in a migration, and can't be mined.

```
https://<user>.github.io/<repo>/#F8oJgxOaSY3d9ZKAA
                                └── the destination lives here
```

## How it works

`index.html` is both the link maker and the redirector. Open it plainly and you get
the form; open it with a fragment and it decodes the fragment and forwards you.

Making the payload small, in order of how much each step saves:

1. **Tracking parameters are stripped** — `utm_*`, `fbclid`, `gclid`, `igshid`, `si`
   and friends. On real-world shared links this is usually the biggest single win,
   and it can be switched off.
2. **Canonicalisation** — the scheme, a `www.` prefix and a trailing slash are
   recorded as individual *bits* in a one-byte header rather than as characters.
   `https://www.` costs 12 characters normally, and 0 here.
3. **Host dictionary** — about 160 common hosts (`github.com`, `youtube.com`,
   `en.wikipedia.org`, …) collapse to a single byte.
4. **Three competing body encodings**, of which the shortest is kept:
   - **text6** packs each URL byte as a 6-bit symbol written *directly* into the
     Base64url alphabet. Since Base64 is itself 6 bits per character, an ordinary
     lowercase URL comes out at exactly **one character per character** — no
     expansion whatsoever. Capitals cost a shift symbol; anything else escapes to a
     literal byte.
   - **raw** is plain 8-bit bytes, which wins on mixed-case ID tokens (Google Docs
     links, YouTube video IDs) where text6's shift symbols would cost more.
   - **deflate** uses `CompressionStream('deflate-raw')` and wins once a URL is long
     enough to pay off its ~5 bytes of overhead.

   Encoding naively as bytes-then-Base64 costs 1.33 characters per character; this
   costs 1.0 or less. Two header bits record which mode was used.

The whole payload is one continuous bit stream written into `A–Z a–z 0–9 - _`, so
there is no padding, nothing rounds up to a byte boundary, and the result survives
chat apps, QR codes and autolinkers without percent-encoding.

The payload rides in the URL **fragment**, which browsers never transmit. GitHub's
servers never see the destination, and neither does anything else.

### Wire format (v2)

```
6 bits   header   bits 0-1  scheme: 0 = https://  1 = http://  2 = verbatim
                  bit  2    "www." was stripped from the host
                  bit  3    host came from the dictionary
                  bits 4-5  body mode: 0 = text6, 1 = raw, 2 = deflate
8 bits   host dictionary index — present only when bit 3 is set
body     text6   : 6-bit symbols, terminated by END (63)
                   0-60 literal byte, 61 SHIFT (uppercase next), 62 ESC (8-bit
                   literal follows), 63 END
         raw     : UTF-8 bytes, 8 bits each
         deflate : DEFLATE-raw bytes, 8 bits each

The body is "host + /path?query#frag", or just the tail when the host is
dictionary-encoded, or the entire URL when the scheme is verbatim.
```

The tail is sliced out of `url.href` rather than assembled from
`pathname + search + hash`, because the latter silently discards a trailing empty
`?` or `#` and would change the destination.

URLs carrying `user:password@` are always stored verbatim — the compact form has
nowhere to keep userinfo, and dropping it would repoint the link.

The dictionary is **append-only**. Reordering or removing an entry would silently
repoint every link already shared.

## The honest trade-off

Without storage, a link can never be shorter than the information it carries. Long,
parameter-heavy URLs — the ones people actually want shortened — compress well.
Already-terse URLs come out longer. The UI shows both lengths and says plainly which
way it went, rather than pretending.

| Input | Input | Payload | Mode that won |
| --- | --- | --- | --- |
| `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&utm_source=newsletter` | 71 | 34 | dictionary + text6 |
| `https://en.wikipedia.org/wiki/Uniform_Resource_Locator` | 54 | 37 | dictionary + text6 |
| `https://github.com/anthropics/claude-code/blob/main/README.md` | 61 | 53 | dictionary + text6 |
| `https://shop.example.co.uk/products/widget-2000?colour=blue&size=large&variant=998877&currency=GBP` | 98 | 95 | text6 |
| `https://example.com` | 19 | 13 | text6 |

The payload is what the codec produces; your Pages origin is added on top of it. So
the win is real for the first rows and swallowed by the origin for the last one.

Fixed overhead is your Pages origin, so a short repo name — or a custom domain —
matters as much as the codec does. `jar99.github.io/l/#…` beats
`jar99.github.io/ClentLinkShort/#…` by 13 characters on every link ever made.

## Safety

Auto-forwarding is restricted to `http:` and `https:`. Schemes that can execute code
(`javascript:`, `data:`, `vbscript:`, `blob:`, `file:`) are refused both when creating
a link and when opening one, so a hand-crafted fragment can't turn the page into an
XSS vector. Other schemes (`mailto:`, `ftp:`, `magnet:`, …) can be encoded but always
require a click.

Append `~` to any Clent link to see where it goes instead of following it:

```
https://user.github.io/repo/#F8oJgxOaSY3d9ZKAA~
```

## Deploying

The included workflow publishes on every push to `main` — set
**Settings → Pages → Source** to **GitHub Actions**.

Or skip the workflow entirely: set **Source** to **Deploy from a branch**, pick the
branch and `/ (root)`. There is no build step; the site is one file.

## Browser support

Needs `CompressionStream`/`DecompressionStream` with the `deflate-raw` format —
Chrome 103+, Firefox 113+, Safari 16.4+. Where it's missing, links are still created
and opened correctly, just without the compression stage.

## Development

No toolchain and no dependencies. Open `index.html`, or:

```sh
python3 -m http.server 8000
```

`node test.mjs` extracts the codec straight out of `index.html` and round-trips it
against a set of awkward URLs (unicode paths, ports, userinfo, non-http schemes) plus
malformed and hostile payloads.
