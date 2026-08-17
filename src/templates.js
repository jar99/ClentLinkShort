/**
 * URL templates.
 *
 * A great many shared links are one site's URL scheme with an identifier
 * dropped into it. `https://www.youtube.com/watch?v=dQw4w9WgXcQ` is 43
 * characters of which 11 carry information; the rest is a shape repeated
 * across every YouTube link ever shared.
 *
 * A template names that shape once and stores only the identifier. The saving
 * is twofold: the boilerplate disappears, and the identifier is encoded at
 * exactly the width its own alphabet needs. A YouTube ID is 11 characters of
 * Base64url, which is 66 bits — while the general text encoder, which has to
 * pay a shift symbol for every capital, would spend closer to 100.
 *
 * APPEND-ONLY once published: an index is a wire encoding.
 *
 * Correctness rule, enforced by asTemplate() below: a template is only used
 * if substituting the captured values back into the pattern reproduces the
 * original URL character for character. Anything else would be a silent
 * redirect to the wrong place, which is the one failure that must never ship.
 *
 * Templates apply to https URLs only — every pattern is an https literal, and
 * asTemplate() bails early on anything else. That is a table property, not a
 * codec rule: an http pattern added here would work.
 */

import { ClentError } from "./bits.js";
import { emitText, decodeText, textBits } from "./text.js";

const slotEncoder = new TextEncoder();

/**
 * Slot alphabets. `bits` is what one character costs; a character outside the
 * alphabet disqualifies the template for that URL.
 *
 * The special slot type "text" is not listed here: it is Huffman-coded by
 * text.js, END-terminated instead of length-prefixed, and accepts any value —
 * capitals, dots, percent-escapes — at the text mode's own cost. Use it for
 * slugs and titles; use a charset for dense IDs, which beat it.
 * @type {Readonly<Record<string, {chars: string, bits: number}>>}
 */
export const CHARSETS = Object.freeze({
  // Base64url — YouTube video IDs, many CDN keys.
  b64: { chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_", bits: 6 },
  // Digits — status IDs, numeric post IDs. 4 bits rather than the 6 a text
  // encoder would spend.
  dec: { chars: "0123456789", bits: 4 },
  // Uppercase and digits — Amazon ASINs, order references.
  up36: { chars: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ", bits: 6 },
  // Lowercase URL-slug characters — usernames, repository names, article slugs.
  slug: { chars: "abcdefghijklmnopqrstuvwxyz0123456789-_.", bits: 6 },
  // Lowercase hex — commit hashes, content digests.
  hex: { chars: "0123456789abcdef", bits: 4 },
});

/**
 * The templates themselves.
 *
 * `{0}`, `{1}` mark slots, in order. `slots` gives each one's alphabet.
 * Patterns are matched against the URL exactly as the URL parser normalises
 * it, so they carry the `www.` and trailing slash the browser would produce.
 *
 * @type {ReadonlyArray<{pattern: string, slots: string[]}>}
 */
export const TEMPLATES = Object.freeze([
  // ---- video ------------------------------------------------------------
  { pattern: "https://www.youtube.com/watch?v={0}", slots: ["b64"] },
  { pattern: "https://youtu.be/{0}", slots: ["b64"] },
  { pattern: "https://m.youtube.com/watch?v={0}", slots: ["b64"] },
  { pattern: "https://www.youtube.com/shorts/{0}", slots: ["b64"] },

  // ---- social -----------------------------------------------------------
  { pattern: "https://twitter.com/{0}/status/{1}", slots: ["slug", "dec"] },
  { pattern: "https://x.com/{0}/status/{1}", slots: ["slug", "dec"] },
  { pattern: "https://www.facebook.com/{0}/posts/{1}", slots: ["slug", "dec"] },
  { pattern: "https://www.instagram.com/p/{0}/", slots: ["b64"] },
  { pattern: "https://www.instagram.com/reel/{0}/", slots: ["b64"] },
  { pattern: "https://www.reddit.com/r/{0}/comments/{1}/", slots: ["slug", "slug"] },
  { pattern: "https://old.reddit.com/r/{0}/comments/{1}/", slots: ["slug", "slug"] },
  { pattern: "https://www.tiktok.com/@{0}/video/{1}", slots: ["slug", "dec"] },
  { pattern: "https://bsky.app/profile/{0}/post/{1}", slots: ["slug", "b64"] },
  { pattern: "https://www.linkedin.com/posts/{0}", slots: ["slug"] },

  // ---- images -----------------------------------------------------------
  { pattern: "https://i.imgur.com/{0}.jpg", slots: ["b64"] },
  { pattern: "https://i.imgur.com/{0}.png", slots: ["b64"] },
  { pattern: "https://imgur.com/a/{0}", slots: ["b64"] },
  { pattern: "https://i.redd.it/{0}.jpg", slots: ["slug"] },
  { pattern: "https://i.redd.it/{0}.png", slots: ["slug"] },
  { pattern: "https://pbs.twimg.com/media/{0}.jpg", slots: ["b64"] },

  // ---- shopping ---------------------------------------------------------
  { pattern: "https://www.amazon.com/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.co.uk/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.de/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.com/gp/product/{0}", slots: ["up36"] },
  { pattern: "https://www.ebay.com/itm/{0}", slots: ["dec"] },
  { pattern: "https://www.etsy.com/listing/{0}/{1}", slots: ["dec", "slug"] },

  // ---- reference and code ----------------------------------------------
  { pattern: "https://github.com/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://github.com/{0}/{1}/issues/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://github.com/{0}/{1}/pull/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://en.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://arxiv.org/abs/{0}", slots: ["slug"] },
  { pattern: "https://doi.org/10.{0}", slots: ["slug"] },
  { pattern: "https://open.spotify.com/track/{0}", slots: ["b64"] },
  { pattern: "https://open.spotify.com/album/{0}", slots: ["b64"] },
  { pattern: "https://news.ycombinator.com/item?id={0}", slots: ["dec"] },
  { pattern: "https://stackoverflow.com/questions/{0}/{1}", slots: ["dec", "slug"] },

  // ---- v7 additions ------------------------------------------------------
  // The timestamped YouTube share — the most-shared link shape there is.
  { pattern: "https://www.youtube.com/watch?v={0}&t={1}s", slots: ["b64", "dec"] },
  { pattern: "https://www.youtube.com/watch?v={0}&t={1}", slots: ["b64", "dec"] },
  { pattern: "https://youtu.be/{0}?t={1}s", slots: ["b64", "dec"] },
  { pattern: "https://youtu.be/{0}?t={1}", slots: ["b64", "dec"] },
  // Real article names carry capitals, parentheses and percent-escapes; the
  // old slug slot silently missed nearly all of them.
  { pattern: "https://de.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://fr.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://es.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://ru.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://ja.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://it.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://pl.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://nl.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://pt.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://zh.wikipedia.org/wiki/{0}", slots: ["text"] },
  { pattern: "https://github.com/{0}/{1}/blob/{2}", slots: ["slug", "slug", "text"] },
  { pattern: "https://github.com/{0}/{1}/tree/{2}", slots: ["slug", "slug", "text"] },
  { pattern: "https://github.com/{0}/{1}/releases/tag/{2}", slots: ["slug", "slug", "text"] },
  { pattern: "https://www.reddit.com/r/{0}/comments/{1}/{2}/", slots: ["slug", "slug", "text"] },
  { pattern: "https://old.reddit.com/r/{0}/comments/{1}/{2}/", slots: ["slug", "slug", "text"] },
  { pattern: "https://stackoverflow.com/a/{0}", slots: ["dec"] },
  { pattern: "https://stackoverflow.com/q/{0}", slots: ["dec"] },
  { pattern: "https://vimeo.com/{0}", slots: ["dec"] },
  { pattern: "https://www.twitch.tv/videos/{0}", slots: ["dec"] },
  { pattern: "https://open.spotify.com/episode/{0}", slots: ["b64"] },
  { pattern: "https://open.spotify.com/playlist/{0}", slots: ["b64"] },
  { pattern: "https://commons.wikimedia.org/wiki/File:{0}", slots: ["text"] },

  // ---- appended for wire v2: shapes the corpus and the news cycle carry --
  { pattern: "https://www.threads.net/@{0}/post/{1}", slots: ["slug", "b64"] },
  { pattern: "https://t.me/{0}/{1}", slots: ["slug", "dec"] },
  { pattern: "https://medium.com/@{0}/{1}", slots: ["slug", "text"] },
  { pattern: "https://dev.to/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://www.npmjs.com/package/{0}", slots: ["text"] },
  { pattern: "https://pypi.org/project/{0}/", slots: ["slug"] },
  { pattern: "https://crates.io/crates/{0}", slots: ["slug"] },
  { pattern: "https://mastodon.social/@{0}/{1}", slots: ["text", "dec"] },
  { pattern: "https://lemmy.world/post/{0}", slots: ["dec"] },
  { pattern: "https://www.twitch.tv/{0}/clip/{1}", slots: ["slug", "text"] },
  { pattern: "https://music.youtube.com/watch?v={0}", slots: ["b64"] },
  { pattern: "https://maps.app.goo.gl/{0}", slots: ["b64"] },
  // People paste "youtube.com/watch?v=…" without the www; the parser keeps
  // the host as typed, so the bare spelling needs its own patterns.
  { pattern: "https://youtube.com/watch?v={0}", slots: ["b64"] },
  { pattern: "https://youtube.com/watch?v={0}&t={1}s", slots: ["b64", "dec"] },
  { pattern: "https://youtube.com/shorts/{0}", slots: ["b64"] },
  // Short-link services people re-shorten from — a.co is Amazon's own,
  // amzn.to its bitly, vm.tiktok the app's share button:
  { pattern: "https://a.co/d/{0}", slots: ["b64"] },
  { pattern: "https://amzn.to/{0}", slots: ["b64"] },
  { pattern: "https://amzn.eu/d/{0}", slots: ["b64"] },
  { pattern: "https://vm.tiktok.com/{0}/", slots: ["b64"] },
  // Proposed by tools/mine-templates.mjs from corpus coverage:
  { pattern: "https://www.ft.com/content/{0}", slots: ["b64"] },
  { pattern: "https://www.bbc.com/news/articles/{0}", slots: ["b64"] },
  { pattern: "https://www.bbc.co.uk/news/articles/{0}", slots: ["b64"] },
  { pattern: "https://www.nature.com/articles/{0}", slots: ["b64"] },
  { pattern: "https://www.wired.com/story/{0}/", slots: ["b64"] },
  { pattern: "https://zenodo.org/records/{0}", slots: ["dec"] },
  { pattern: "https://www.phoronix.com/news/{0}", slots: ["b64"] },
  { pattern: "https://spectrum.ieee.org/{0}", slots: ["b64"] },
  { pattern: "https://apps.apple.com/us/app/{0}/{1}", slots: ["b64", "b64"] },

  // ---- appended: the majority-of-the-internet sweep ----------------------
  // Link shorteners. Expanding them isn't possible client-side, but people
  // re-wrap them for the QR code, the preview mode and the integrity tag,
  // and the token is all they carry.
  { pattern: "https://bit.ly/{0}", slots: ["b64"] },
  { pattern: "https://tinyurl.com/{0}", slots: ["b64"] },
  { pattern: "https://t.co/{0}", slots: ["b64"] },
  { pattern: "https://goo.gl/{0}", slots: ["b64"] },
  { pattern: "https://is.gd/{0}", slots: ["b64"] },
  { pattern: "https://buff.ly/{0}", slots: ["b64"] },
  { pattern: "https://ow.ly/{0}", slots: ["b64"] },
  { pattern: "https://rb.gy/{0}", slots: ["b64"] },
  { pattern: "https://lnkd.in/{0}", slots: ["b64"] },
  { pattern: "https://fb.me/{0}", slots: ["b64"] },
  { pattern: "https://fb.watch/{0}/", slots: ["b64"] },
  { pattern: "https://we.tl/{0}", slots: ["b64"] },
  { pattern: "https://forms.gle/{0}", slots: ["b64"] },
  { pattern: "https://photos.app.goo.gl/{0}", slots: ["b64"] },
  { pattern: "https://spotify.link/{0}", slots: ["b64"] },
  { pattern: "https://on.soundcloud.com/{0}", slots: ["b64"] },

  // Chat, calls and invites.
  { pattern: "https://wa.me/{0}", slots: ["dec"] },
  { pattern: "https://chat.whatsapp.com/{0}", slots: ["b64"] },
  { pattern: "https://discord.gg/{0}", slots: ["b64"] },
  { pattern: "https://discord.com/invite/{0}", slots: ["b64"] },
  { pattern: "https://discord.com/channels/{0}/{1}/{2}", slots: ["dec", "dec", "dec"] },
  { pattern: "https://t.me/{0}", slots: ["slug"] },
  { pattern: "https://meet.google.com/{0}", slots: ["slug"] },
  { pattern: "https://zoom.us/j/{0}", slots: ["dec"] },

  // Documents and files — the links every workplace passes around.
  { pattern: "https://docs.google.com/document/d/{0}/edit", slots: ["b64"] },
  { pattern: "https://docs.google.com/spreadsheets/d/{0}/edit", slots: ["b64"] },
  { pattern: "https://docs.google.com/presentation/d/{0}/edit", slots: ["b64"] },
  { pattern: "https://docs.google.com/forms/d/e/{0}/viewform", slots: ["b64"] },
  { pattern: "https://drive.google.com/file/d/{0}/view", slots: ["b64"] },
  { pattern: "https://drive.google.com/drive/folders/{0}", slots: ["b64"] },
  { pattern: "https://www.dropbox.com/s/{0}/{1}", slots: ["b64", "text"] },
  { pattern: "https://www.dropbox.com/scl/fi/{0}/{1}", slots: ["b64", "text"] },
  { pattern: "https://pastebin.com/{0}", slots: ["b64"] },
  { pattern: "https://colab.research.google.com/drive/{0}", slots: ["b64"] },

  // Shopping, across the storefront TLDs people actually buy from.
  { pattern: "https://www.amazon.ca/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.fr/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.it/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.es/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.co.jp/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.in/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.com.au/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.com.mx/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.amazon.nl/dp/{0}", slots: ["up36"] },
  { pattern: "https://www.ebay.co.uk/itm/{0}", slots: ["dec"] },
  { pattern: "https://www.ebay.de/itm/{0}", slots: ["dec"] },
  { pattern: "https://www.aliexpress.com/item/{0}.html", slots: ["dec"] },
  { pattern: "https://www.walmart.com/ip/{0}/{1}", slots: ["text", "dec"] },
  { pattern: "https://www.bestbuy.com/site/{0}/{1}.p", slots: ["text", "dec"] },
  { pattern: "https://www.target.com/p/{0}/-/A-{1}", slots: ["text", "dec"] },
  { pattern: "https://www.airbnb.com/rooms/{0}", slots: ["dec"] },

  // Watching, listening, playing.
  { pattern: "https://www.youtube.com/playlist?list={0}", slots: ["b64"] },
  { pattern: "https://youtube.com/playlist?list={0}", slots: ["b64"] },
  { pattern: "https://www.youtube.com/live/{0}", slots: ["b64"] },
  { pattern: "https://www.youtube.com/@{0}", slots: ["text"] },
  { pattern: "https://www.imdb.com/title/{0}/", slots: ["slug"] },
  { pattern: "https://m.imdb.com/title/{0}/", slots: ["slug"] },
  { pattern: "https://www.netflix.com/title/{0}", slots: ["dec"] },
  { pattern: "https://www.rottentomatoes.com/m/{0}", slots: ["slug"] },
  { pattern: "https://letterboxd.com/film/{0}/", slots: ["slug"] },
  { pattern: "https://www.goodreads.com/book/show/{0}", slots: ["text"] },
  { pattern: "https://myanimelist.net/anime/{0}", slots: ["dec"] },
  { pattern: "https://open.spotify.com/artist/{0}", slots: ["b64"] },
  { pattern: "https://open.spotify.com/show/{0}", slots: ["b64"] },
  { pattern: "https://soundcloud.com/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://store.steampowered.com/app/{0}/", slots: ["dec"] },
  { pattern: "https://store.steampowered.com/app/{0}/{1}/", slots: ["dec", "text"] },
  { pattern: "https://play.google.com/store/apps/details?id={0}", slots: ["slug"] },
  { pattern: "https://addons.mozilla.org/en-US/firefox/addon/{0}/", slots: ["slug"] },
  { pattern: "https://clips.twitch.tv/{0}", slots: ["b64"] },
  { pattern: "https://www.twitch.tv/{0}", slots: ["slug"] },
  { pattern: "https://streamable.com/{0}", slots: ["b64"] },
  { pattern: "https://lichess.org/{0}", slots: ["b64"] },
  { pattern: "https://www.chess.com/game/live/{0}", slots: ["dec"] },
  { pattern: "https://www.strava.com/activities/{0}", slots: ["dec"] },

  // Profiles and communities.
  { pattern: "https://www.instagram.com/{0}/", slots: ["slug"] },
  { pattern: "https://www.tiktok.com/@{0}", slots: ["slug"] },
  { pattern: "https://x.com/{0}", slots: ["slug"] },
  { pattern: "https://www.linkedin.com/in/{0}/", slots: ["slug"] },
  { pattern: "https://www.linkedin.com/in/{0}", slots: ["slug"] },
  { pattern: "https://www.reddit.com/r/{0}/s/{1}", slots: ["slug", "b64"] },
  { pattern: "https://www.reddit.com/user/{0}/", slots: ["slug"] },
  { pattern: "https://redd.it/{0}", slots: ["b64"] },
  { pattern: "https://v.redd.it/{0}", slots: ["b64"] },
  { pattern: "https://www.pinterest.com/pin/{0}/", slots: ["dec"] },
  { pattern: "https://www.facebook.com/share/p/{0}/", slots: ["b64"] },
  { pattern: "https://www.facebook.com/watch/?v={0}", slots: ["dec"] },
  { pattern: "https://www.facebook.com/photo/?fbid={0}", slots: ["dec"] },
  { pattern: "https://linktr.ee/{0}", slots: ["slug"] },
  { pattern: "https://www.patreon.com/posts/{0}", slots: ["slug"] },
  { pattern: "https://ko-fi.com/{0}", slots: ["slug"] },
  { pattern: "https://buymeacoffee.com/{0}", slots: ["slug"] },
  { pattern: "https://www.kickstarter.com/projects/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://www.gofundme.com/f/{0}", slots: ["slug"] },
  { pattern: "https://www.meetup.com/{0}/events/{1}/", slots: ["slug", "dec"] },
  { pattern: "https://www.eventbrite.com/e/{0}", slots: ["slug"] },

  // News in its date-and-slug shapes, plus the wayback machine.
  { pattern: "https://www.nytimes.com/{0}/{1}/{2}/{3}/{4}.html",
    slots: ["dec", "dec", "dec", "slug", "slug"] },
  { pattern: "https://www.nytimes.com/{0}/{1}/{2}/{3}/{4}/{5}.html",
    slots: ["dec", "dec", "dec", "slug", "slug", "slug"] },
  { pattern: "https://www.theguardian.com/{0}/{1}/{2}/{3}/{4}",
    slots: ["slug", "dec", "slug", "dec", "slug"] },
  { pattern: "https://edition.cnn.com/{0}/{1}/{2}/{3}/{4}/index.html",
    slots: ["dec", "dec", "dec", "slug", "slug"] },
  { pattern: "https://www.cnn.com/{0}/{1}/{2}/{3}/{4}/index.html",
    slots: ["dec", "dec", "dec", "slug", "slug"] },
  { pattern: "https://apnews.com/article/{0}", slots: ["slug"] },
  { pattern: "https://www.bbc.com/news/{0}", slots: ["slug"] },
  { pattern: "https://www.bbc.co.uk/news/{0}", slots: ["slug"] },
  { pattern: "https://web.archive.org/web/{0}/{1}", slots: ["dec", "text"] },
  { pattern: "https://archive.org/details/{0}", slots: ["slug"] },

  // Developers' daily links.
  { pattern: "https://gist.github.com/{0}/{1}", slots: ["slug", "hex"] },
  { pattern: "https://github.com/{0}/{1}/commit/{2}", slots: ["slug", "slug", "hex"] },
  { pattern: "https://github.com/{0}/{1}/discussions/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://github.com/{0}/{1}/actions/runs/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://gitlab.com/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://gitlab.com/{0}/{1}/-/issues/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://gitlab.com/{0}/{1}/-/merge_requests/{2}", slots: ["slug", "slug", "dec"] },
  { pattern: "https://bitbucket.org/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://hub.docker.com/r/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://huggingface.co/{0}/{1}", slots: ["text", "text"] },
  { pattern: "https://huggingface.co/datasets/{0}/{1}", slots: ["text", "text"] },
  { pattern: "https://codepen.io/{0}/pen/{1}", slots: ["slug", "b64"] },
  { pattern: "https://godbolt.org/z/{0}", slots: ["b64"] },
  { pattern: "https://caniuse.com/{0}", slots: ["slug"] },
  { pattern: "https://developer.mozilla.org/en-US/docs/{0}", slots: ["text"] },
  { pattern: "https://learn.microsoft.com/en-us/{0}", slots: ["text"] },
  { pattern: "https://docs.python.org/3/library/{0}.html", slots: ["slug"] },
  { pattern: "https://pkg.go.dev/{0}", slots: ["text"] },
  { pattern: "https://www.kaggle.com/{0}/{1}", slots: ["slug", "slug"] },
  { pattern: "https://leetcode.com/problems/{0}/", slots: ["slug"] },
  { pattern: "https://superuser.com/questions/{0}/{1}", slots: ["dec", "slug"] },
  { pattern: "https://serverfault.com/questions/{0}/{1}", slots: ["dec", "slug"] },
  { pattern: "https://askubuntu.com/questions/{0}/{1}", slots: ["dec", "slug"] },
  { pattern: "https://unix.stackexchange.com/questions/{0}/{1}", slots: ["dec", "slug"] },
  { pattern: "https://math.stackexchange.com/questions/{0}/{1}", slots: ["dec", "slug"] },

  // Images and pastes.
  { pattern: "https://imgur.com/gallery/{0}", slots: ["b64"] },
  { pattern: "https://i.imgur.com/{0}.gif", slots: ["b64"] },
  { pattern: "https://i.imgur.com/{0}.jpeg", slots: ["b64"] },
  { pattern: "https://ibb.co/{0}", slots: ["b64"] },
  { pattern: "https://postimg.cc/{0}", slots: ["b64"] },
  { pattern: "https://prnt.sc/{0}", slots: ["b64"] },
  { pattern: "https://gyazo.com/{0}", slots: ["hex"] },
  { pattern: "https://giphy.com/gifs/{0}", slots: ["slug"] },

  // Proposed by tools/mine-templates.mjs from corpus coverage:
  { pattern: "https://www.bloomberg.com/news/articles/{0}/{1}", slots: ["b64", "b64"] },
  { pattern: "https://chromewebstore.google.com/detail/{0}/{1}", slots: ["b64", "b64"] },
  { pattern: "https://www.lesswrong.com/posts/{0}/{1}", slots: ["b64", "b64"] },
  { pattern: "https://www.theverge.com/{0}/{1}/{2}", slots: ["b64", "dec", "b64"] },
  { pattern: "https://www.theverge.com/tech/{0}/{1}", slots: ["dec", "b64"] },
  { pattern: "https://www.abc.net.au/news/{0}/{1}/{2}", slots: ["b64", "b64", "dec"] },
  { pattern: "https://www.businessinsider.com/{0}", slots: ["b64"] },
  { pattern: "https://openai.com/index/{0}/", slots: ["b64"] },
  { pattern: "https://www.anthropic.com/news/{0}", slots: ["b64"] },
  { pattern: "https://www.anthropic.com/research/{0}", slots: ["b64"] },
  { pattern: "https://blog.cloudflare.com/{0}/", slots: ["b64"] },
  { pattern: "https://thenewstack.io/{0}/", slots: ["b64"] },
  { pattern: "https://lwn.net/{0}/{1}/", slots: ["b64", "dec"] },
  { pattern: "https://lwn.net/{0}/{1}/{2}/", slots: ["b64", "dec", "b64"] },
  { pattern: "https://lobste.rs/s/{0}/{1}", slots: ["b64", "b64"] },
  { pattern: "https://www.science.org/content/article/{0}", slots: ["b64"] },
  { pattern: "https://www.sciencedirect.com/science/article/pii/{0}", slots: ["b64"] },
  { pattern: "https://www.bbc.com/future/article/{0}", slots: ["b64"] },
  { pattern: "https://www.engadget.com/{0}/{1}/", slots: ["dec", "b64"] },
]);

/** Longest slot value a template will hold; the length field is 6 bits. */
export const MAX_SLOT = 63;

/**
 * Pre-compiled matchers: a regex per template, plus the literal pieces needed
 * to rebuild the URL from captured values.
 */
export const COMPILED = TEMPLATES.map(({ pattern, slots }, index) => {
  const literals = pattern.split(/\{\d\}/);
  if (literals.length - 1 !== slots.length) {
    // Thrown at module evaluation: a malformed table must fail the build and
    // the test run, not one unlucky decode.
    throw new ClentError(`template "${pattern}" has ${literals.length - 1} slots, ` +
      `declared ${slots.length}`);
  }
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = literals.map(escape).join("(.+?)").replace(/\(\.\+\?\)$/, "(.+)");
  return {
    index,
    pattern,
    slots,
    literals,
    host: pattern.slice("https://".length, pattern.indexOf("/", "https://".length)),
    match: new RegExp(`^${source}$`),
  };
});

/**
 * Templates grouped by the host they apply to.
 *
 * Without this, encoding any URL means running every template's regex. With
 * it, a URL that is not on a templated host does no regex work at all, which
 * is the overwhelming majority of them.
 *
 * @type {ReadonlyMap<string, typeof COMPILED>}
 */
export const BY_HOST = (() => {
  /** @type {Map<string, typeof COMPILED>} */
  const byHost = new Map();
  for (const template of COMPILED) {
    if (!byHost.has(template.host)) byHost.set(template.host, []);
    byHost.get(template.host).push(template);
  }
  return byHost;
})();

/**
 * Rebuild a URL from a template index and its slot values.
 * @param {number} index
 * @param {string[]} values
 * @returns {string}
 */
export function fill(index, values) {
  const template = COMPILED[index];
  if (!template) throw new ClentError(`This link uses template ${index}, which this page does not have.`);
  let out = template.literals[0];
  for (let i = 0; i < values.length; i++) out += values[i] + template.literals[i + 1];
  return out;
}

/**
 * Index of each charset's characters, for encoding.
 * @type {Record<string, {set: {chars: string, bits: number}, index: Map<string, number>}>}
 */
export const CHARSET_INDEX = Object.fromEntries(Object.entries(CHARSETS).map(([name, set]) => [
  name, { set, index: new Map([...set.chars].map((c, i) => [c, i])) },
]));

/**
 * Try to express a URL as one of the templates.
 *
 * Returns null unless the captured values round-trip: every value has to fit
 * its declared alphabet, be short enough for the 6-bit length field, and
 * substituting them back must reproduce the URL exactly. Approximate matches
 * are worse than useless here — they would resolve to a different page.
 *
 * @param {URL} url
 * @returns {{index: number, values: string[], bits: number}|null}
 */
export function asTemplate(url) {
  // Only templates for this exact host can match, so most URLs do no regex
  // work at all.
  if (url.protocol !== "https:") return null;
  const family = BY_HOST.get(url.host);
  if (!family) return null;

  const href = url.href;
  let best = null;

  for (const template of family) {
    const index = template.index;
    const found = template.match.exec(href);
    if (!found) continue;

    const values = found.slice(1);
    let bits = 0;
    let usable = true;

    for (let slot = 0; slot < values.length; slot++) {
      const value = values[slot];
      if (!value) { usable = false; break; }

      if (template.slots[slot] === "text") {
        // Huffman-coded and END-terminated: any value works, at text cost.
        if (value.length > 255) { usable = false; break; }
        bits += textBits(slotEncoder.encode(value));
        continue;
      }

      const charset = CHARSET_INDEX[template.slots[slot]];
      if (value.length > MAX_SLOT) { usable = false; break; }
      for (const character of value) {
        if (!charset.index.has(character)) { usable = false; break; }
      }
      if (!usable) break;
      bits += 6 + value.length * charset.set.bits;
    }
    if (!usable) continue;

    // The guard that makes this safe to use at all.
    if (fill(index, values) !== href) continue;

    if (!best || bits < best.bits) best = { index, values, bits };
  }
  return best;
}

/**
 * Write a template's index and slot values into an open bit stream. The
 * caller writes the 6-bit header first; this writes everything after it.
 *
 * @param {import("./bits.js").BitWriter} w
 * @param {{index: number, values: string[]}} template
 * @returns {string} the finished payload
 */
export function writeTemplate(w, { index, values }) {
  // The index is open-ended: byte 255 means "add 255 and keep reading", so
  // the table can grow past 256 entries forever without a format change —
  // links made against early indexes never notice later growth.
  let remaining = index;
  while (remaining >= 255) {
    w.push(255, 8);
    remaining -= 255;
  }
  w.push(remaining, 8);
  const slots = COMPILED[index].slots;
  for (let slot = 0; slot < values.length; slot++) {
    if (slots[slot] === "text") {
      emitText(w, slotEncoder.encode(values[slot]));
      continue;
    }
    const charset = CHARSET_INDEX[slots[slot]];
    w.push(values[slot].length, 6);
    for (const character of values[slot]) {
      w.push(charset.index.get(character), charset.set.bits);
    }
  }
  return w.finish();
}

/**
 * Read a template payload (after the header) back into the URL it encodes.
 *
 * @param {import("./bits.js").BitReader} reader
 * @returns {string} the rebuilt URL
 */
export function readTemplate(reader) {
  // Open-ended index: 255 chains. Eight links bound the loop at over two
  // thousand templates — far past plausible, cheap to refuse beyond.
  let index = 0;
  for (let hops = 0; ; hops++) {
    if (hops > 8) throw new ClentError("This link is damaged.");
    const byte = reader.read(8);
    index += byte;
    if (byte !== 255) break;
  }
  const template = COMPILED[index];
  if (!template) throw new ClentError("This link uses a newer template than this page has.");

  const values = [];
  for (const name of template.slots) {
    if (name === "text") {
      const value = decodeText(reader);
      if (!value) throw new ClentError("This link is damaged — an empty field.");
      values.push(value);
      continue;
    }
    const charset = CHARSETS[name];
    const length = reader.read(6);
    if (length === 0) throw new ClentError("This link is damaged — an empty field.");
    let value = "";
    for (let i = 0; i < length; i++) {
      const at = reader.read(charset.bits);
      const character = charset.chars[at];
      if (character === undefined) throw new ClentError("This link is damaged.");
      value += character;
    }
    values.push(value);
  }
  return fill(index, values);
}
