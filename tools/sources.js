/**
 * Where the corpus comes from.
 *
 * Each source is an async generator of URL strings. They are deliberately
 * unalike: a codec that only ever sees links from one place will pass its own
 * tests and then meet the real web.
 *
 * A note on DuckDuckGo, which is the obvious thing to reach for: its
 * `html.` and `lite.` endpoints answer scripted requests with a bot-detection
 * challenge (HTTP 202 and an "anomaly" page), and working around that is
 * circumventing an anti-abuse control. Its public API is the Instant Answer
 * API, which returns encyclopaedia summaries and `duckduckgo.com` disambigu-
 * ation links rather than web results, so it yields almost no usable URLs.
 * There is no supported way to get a result feed out of it. The sources below
 * are the ones that publish an API for this and paginate deeply enough to
 * matter.
 */

/** Rotated through GDELT so the news sample is not all one topic. */
const NEWS_TOPICS = [
  "election", "economy", "health", "technology", "climate", "sport",
  "education", "transport", "energy", "agriculture", "court", "housing",
  "inflation", "vaccine", "railway", "festival", "museum", "startup",
];

/**
 * Wikipedia language editions. Non-Latin scripts matter here: they produce
 * percent-encoded and IDN URLs, which is where a text codec goes wrong.
 */
const WIKIS = [
  "en", "de", "fr", "es", "ru", "ja", "zh", "pt", "it", "pl",
  "nl", "ar", "fa", "he", "ko", "tr", "id", "vi", "sv", "uk",
  "cs", "hu", "fi", "th", "el", "hi", "no", "da", "ro", "bg",
  "ca", "eu", "gl", "sr", "sk", "sl", "lt", "hr", "ms", "bn",
];

/** Stack Exchange sites, for links people actually paste into questions. */
const SE_SITES = [
  "stackoverflow", "serverfault", "superuser", "askubuntu", "unix",
  "security", "math", "physics", "english", "electronics",
];

/**
 * Merge N concurrent producers into one async URL stream.
 *
 * Every source that talks to more than one server (or can partition its
 * keyspace) uses this: each producer is one polite sequential stream, the
 * run costs the slowest producer instead of the sum, and the consumer stops
 * all of them the moment the target is reached.
 *
 * @param {number} target stop after this many URLs
 * @param {string} label progress label
 * @param {(label: string, n: number, target: number) => void} progress
 * @param {Array<(push: (url: string) => void, stopped: () => boolean) => Promise<void>>} producers
 * @returns {AsyncGenerator<string>}
 */
async function* channel(target, label, progress, producers) {
  /** @type {string[]} */
  const queue = [];
  /** @type {(() => void)|null} */
  let wake = null;
  let running = producers.length;
  let stop = false;
  const notify = () => { if (wake) { wake(); wake = null; } };
  const push = (url) => { queue.push(url); notify(); };
  const stopped = () => stop;

  for (const producer of producers) {
    producer(push, stopped).catch(() => {}).then(() => { running--; notify(); });
  }

  let total = 0;
  while (running > 0 || queue.length) {
    if (!queue.length) {
      await new Promise((resolve) => { wake = resolve; });
      continue;
    }
    while (queue.length) {
      yield queue.shift();
      if (++total >= target) {
        stop = true;
        return;
      }
    }
    progress(label, total, target);
  }
}

/**
 * External links cited in articles, across many language editions. Deep,
 * messy, and full of URLs typed by hand a decade ago.
 *
 * A FEW editions page concurrently — one polite sequential stream each,
 * paced with a small sleep. Thirty at once trips Wikimedia's per-IP rate
 * limiting and every stream dies early; four slow streams are measured to
 * live long enough to matter.
 */
export async function* wikipedia(target, { get, progress, sleep }) {
  const CONCURRENT = 4;
  const perWiki = Math.ceil(target / WIKIS.length);
  let nextWiki = 0;

  yield* channel(target, "wikipedia", progress,
    Array.from({ length: CONCURRENT }, () => async (push, stopped) => {
      while (!stopped()) {
        const at = nextWiki++;
        if (at >= WIKIS.length) return;
        const lang = WIKIS[at];
        let cont = "";
        let fromWiki = 0;
        while (fromWiki < perWiki && !stopped()) {
          let body;
          try {
            body = await get(`https://${lang}.wikipedia.org/w/api.php?action=query` +
              "&list=exturlusage&eulimit=500&format=json&formatversion=2" +
              (cont ? `&eucontinue=${encodeURIComponent(cont)}` : ""));
          } catch {
            return; // a single wiki being unavailable should not stop the run
          }
          const rows = body?.query?.exturlusage ?? [];
          if (!rows.length) break;
          for (const row of rows) {
            if (row.url) {
              push(row.url);
              fromWiki++;
            }
          }
          cont = body?.continue?.eucontinue;
          if (!cont) break;
          await sleep(250); // the pace that keeps the limiter asleep
        }
      }
    }));
}

/**
 * Links submitted to Hacker News. Algolia caps a query at 1000 hits, so
 * each walker pages backwards through time using the oldest timestamp of a
 * page as the next upper bound — and the site's whole history is split
 * into year slices walked CONCURRENTLY, so a deep run costs one slice's
 * walk, not eighteen years of one cursor.
 */
export async function* hackernews(target, { get, progress }) {
  const WALKERS = 4;
  const now = Math.floor(Date.now() / 1000);
  const epoch = 1160000000; // HN's first posts, autumn 2006
  const slice = Math.ceil((now - epoch) / WALKERS);
  const perWalker = Math.ceil(target / WALKERS);

  yield* channel(target, "hn", progress,
    Array.from({ length: WALKERS }, (_, k) => async (push, stopped) => {
      const floor = now - (k + 1) * slice;
      let before = now - k * slice;
      let seen = 0;
      while (seen < perWalker && !stopped()) {
        let body;
        try {
          body = await get("https://hn.algolia.com/api/v1/search_by_date?tags=story" +
            `&hitsPerPage=1000&numericFilters=created_at_i<${before},created_at_i>${floor}`);
        } catch {
          return;
        }
        const hits = body?.hits ?? [];
        if (!hits.length) return;
        for (const hit of hits) {
          if (hit.url) {
            push(hit.url);
            seen++;
          }
        }
        const oldest = Math.min(...hits.map((h) => h.created_at_i).filter(Number.isFinite));
        if (!Number.isFinite(oldest) || oldest >= before) return;
        before = oldest;
      }
    }));
}

/**
 * URLs people paste into Hacker News COMMENTS — recommendations, sources,
 * rebuttals. Shared-in-conversation links, a different population from
 * submitted stories, from the same generous API.
 */
export async function* hncomments(target, { get, progress, deadline = 600000 }) {
  const WALKERS = 4;
  const now = Math.floor(Date.now() / 1000);
  const epoch = 1160000000;
  const slice = Math.ceil((now - epoch) / WALKERS);
  const perWalker = Math.ceil(target / WALKERS);
  // Link density in comments is low — a walker chasing a big quota would
  // page for hours. The source is deadline-budgeted: it contributes what
  // ten minutes of polite paging finds, which is plenty of shapes.
  const until = Date.now() + deadline;

  yield* channel(target, "hn-comments", progress,
    Array.from({ length: WALKERS }, (_, k) => async (push, stopped) => {
      const floor = now - (k + 1) * slice;
      let before = now - k * slice;
      let seen = 0;
      while (seen < perWalker && !stopped() && Date.now() < until) {
        let body;
        try {
          body = await get("https://hn.algolia.com/api/v1/search_by_date?tags=comment" +
            `&hitsPerPage=1000&numericFilters=created_at_i<${before},created_at_i>${floor}`);
        } catch {
          return;
        }
        const hits = body?.hits ?? [];
        if (!hits.length) return;
        for (const hit of hits) {
          // Comment bodies arrive as escaped HTML; links hide in hrefs.
          for (const match of String(hit.comment_text ?? "")
            .matchAll(/href="(https?:\/\/[^"]+)"/g)) {
            push(unescapeXml(match[1]));
            seen++;
          }
        }
        const oldest = Math.min(...hits.map((h) => h.created_at_i).filter(Number.isFinite));
        if (!Number.isFinite(oldest) || oldest >= before) return;
        before = oldest;
      }
    }));
}

/**
 * News articles worldwide. GDELT asks for one request every five seconds, so
 * this is the slow source; it earns its place by reaching news domains in
 * languages and countries nothing else here touches.
 */
export async function* gdelt(target, { get, progress, sleep, deadline = 180000 }) {
  const until = Date.now() + deadline;
  let seen = 0;
  let topic = 0;
  let failures = 0;
  // Budgeted rather than retried into the ground: GDELT answers a scripted
  // run with 429 often enough that an unbounded backoff loop turns a small
  // source into a 40-minute stall for a couple of thousand URLs.
  while (seen < target && topic < NEWS_TOPICS.length * 2 &&
         failures < 4 && Date.now() < until) {
    const query = NEWS_TOPICS[topic % NEWS_TOPICS.length];
    topic++;
    let body;
    try {
      body = await get("https://api.gdeltproject.org/api/v2/doc/doc?query=" +
        `${encodeURIComponent(query)}&mode=artlist&format=json&maxrecords=250` +
        `&timespan=${1 + (topic % 24)}d`, { retries: 1 });
    } catch {
      failures++;
      await sleep(5200);
      continue;
    }
    for (const article of body?.articles ?? []) {
      if (article.url) {
        yield article.url;
        seen++;
      }
    }
    progress("gdelt", seen, target);
    await sleep(5200); // their stated limit is one request per five seconds
  }
}

/** URLs pasted into Stack Exchange questions and answers. */
export async function* stackexchange(target, { get, progress }) {
  let seen = 0;
  for (const site of SE_SITES) {
    for (let page = 1; page <= 12 && seen < target; page++) {
      let body;
      try {
        body = await get("https://api.stackexchange.com/2.3/questions?" +
          `site=${site}&filter=withbody&pagesize=100&page=${page}` +
          "&order=desc&sort=creation");
      } catch {
        break;
      }
      for (const item of body?.items ?? []) {
        for (const match of String(item.body ?? "").matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
          yield match[0];
          seen++;
        }
      }
      progress("stackexchange", seen, target);
      if (body?.has_more === false) break;
      if (body?.backoff) return; // respect their throttle rather than push past it
    }
    if (seen >= target) return;
  }
}

/**
 * Domains from the Tranco ranking, head first.
 *
 * Spreading a fixed budget evenly across all million ranks sounds fairer and
 * is much worse: popularity is roughly Zipfian, so rank 30 carries more weight
 * than ranks 900,000 to 1,000,000 put together. Taking the head maximises the
 * share of real traffic the corpus represents.
 *
 * A slice of the tail is kept anyway — a fifth of the budget, spread thin —
 * because the far end of the list is where the odd TLDs and IDN domains live,
 * and those are worth encoding at least once.
 *
 * @param {string[]} ranks domains in rank order, index 0 = rank 1
 */
export function* trancoDomains(target, ranks) {
  if (target <= 0 || !ranks.length) return;

  const head = Math.min(ranks.length, Math.round(target * 0.8));
  for (let i = 0; i < head; i++) yield `https://${ranks[i]}/`;

  const tailBudget = target - head;
  if (tailBudget <= 0 || head >= ranks.length) return;
  const step = Math.max(1, Math.floor((ranks.length - head) / tailBudget));
  for (let i = head; i < ranks.length; i += step) yield `https://${ranks[i]}/`;
}

export const SOURCES = { wikipedia, hackernews, gdelt, stackexchange };
export { WIKIS, SE_SITES };

/* -------------------------------------------------------------------------- *
 * Everyday links: news, shopping, social, images
 *
 * The sources above skew heavily towards citations and tech submissions. The
 * links people actually run through a shortener are product pages, articles,
 * posts and photos, and those have completely different shapes: long opaque
 * product IDs, campaign parameters, CDN hostnames, image extensions.
 * -------------------------------------------------------------------------- */

/** News and deal feeds. RSS is shallow but the URLs are exactly the real thing. */
const FEEDS = [
  // news
  "https://feeds.bbci.co.uk/news/rss.xml",
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/technology/rss.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml",
  "https://www.theguardian.com/world/rss",
  "https://www.theguardian.com/uk/business/rss",
  "https://www.theguardian.com/uk/technology/rss",
  "https://www.theguardian.com/uk/lifeandstyle/rss",
  "https://www.theverge.com/rss/index.xml",
  "https://feeds.arstechnica.com/arstechnica/index",
  "https://www.npr.org/rss/rss.php?id=1001",
  "https://www.npr.org/rss/rss.php?id=1006",
  "https://feeds.washingtonpost.com/rss/world",
  "https://feeds.skynews.com/feeds/rss/home.xml",
  "https://www.aljazeera.com/xml/rss/all.xml",
  "https://rss.cnn.com/rss/edition.rss",
  "https://feeds.nbcnews.com/nbcnews/public/news",
  "https://abcnews.go.com/abcnews/topstories",
  "https://www.cbsnews.com/latest/rss/main",
  "https://time.com/feed/",
  "https://www.wired.com/feed/rss",
  "https://techcrunch.com/feed/",
  "https://www.engadget.com/rss.xml",
  "https://gizmodo.com/feed",
  "https://lifehacker.com/feed/rss",
  "https://www.eurogamer.net/feed",
  "https://www.polygon.com/rss/index.xml",
  "https://www.espn.com/espn/rss/news",
  "https://feeds.bbci.co.uk/sport/rss.xml",
  "https://lobste.rs/rss",
  // shopping and deals — these link out to retailers, which is the point
  "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1",
  "https://feeds.feedburner.com/SlickdealsnetFP",
  "https://www.dealnews.com/rss.xml",
  // newsletters — substack and substack-shaped, the URLs people forward
  "https://astralcodexten.substack.com/feed",
  "https://www.slowboring.com/feed",
  "https://newsletter.pragmaticengineer.com/feed",
  "https://www.platformer.news/rss/",
  "https://www.garbageday.email/feed",
  "https://simonwillison.net/atom/everything/",
  "https://stratechery.com/feed/",
  // youtube channel feeds — real watch?v= URLs, straight from the source
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCX6OQ3DkcsbYNE6H8uQQuVA",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCHnyfMqiRRG1u-2MsSQLbXA",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCBJycsmduvYEL83R_U4JriQ",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCsXVk37bltHxD1rDPwtNM8Q",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCYO_jab_esuFRV4b17AJtAw",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UC6107grRI4m0o2-emgoDnAA",
  "https://www.youtube.com/feeds/videos.xml?channel_id=UCXuqSBlHAE6Xw-yeJA0Tunw",
];

/**
 * Link-aggregator posts from Lemmy instances. Federated, so a handful of
 * instances reach a wide spread of communities — news, deals, photography,
 * memes — and it paginates deeply enough to be a real source.
 */
const LEMMY = [
  "lemmy.world", "lemmy.ml", "sh.itjust.works", "programming.dev",
  "beehaw.org", "feddit.org", "lemm.ee", "sopuli.xyz",
];

const URL_IN_TEXT = /https?:\/\/[^\s"'<>)\]]+/g;

/**
 * Undo XML escaping. Feeds write `&amp;` between query parameters, so without
 * this the corpus fills up with URLs that were never real.
 */
const unescapeXml = (text) => text
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&apos;|&#39;|&#034;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&amp;/g, "&");   // last, so "&amp;lt;" does not become "<"

/** Pull every plausible URL out of an RSS or Atom document. */
function* urlsFromFeed(xml) {
  for (const match of xml.matchAll(/<link[^>]*href=["']([^"']+)["']/gi)) {
    yield unescapeXml(match[1]);
  }
  for (const match of xml.matchAll(/<link>([^<]+)<\/link>/gi)) yield unescapeXml(match[1]);
  for (const match of xml.matchAll(/<guid[^>]*>([^<]+)<\/guid>/gi)) yield unescapeXml(match[1]);
  // Feed bodies carry outbound links too, which is where the retailer URLs are.
  for (const match of xml.matchAll(/<(?:description|content:encoded)[^>]*>([\s\S]*?)<\//gi)) {
    for (const found of unescapeXml(match[1]).matchAll(URL_IN_TEXT)) yield found[0];
  }
}

/** News and shopping links from RSS/Atom feeds. */
export async function* feeds(target, { get, progress }) {
  let seen = 0;
  for (const feed of FEEDS) {
    if (seen >= target) return;
    let xml;
    try {
      const response = await get(feed, { json: false, retries: 1 });
      xml = await response.text();
    } catch {
      continue; // one dead feed shouldn't stop the run
    }
    for (const url of urlsFromFeed(xml)) {
      yield url;
      seen++;
    }
    progress("feeds", seen, target);
  }
}

/** Posts from Lemmy instances: social, news, deals and image links. */
export async function* lemmy(target, { get, progress }) {
  let seen = 0;
  const perInstance = Math.ceil(target / LEMMY.length);

  for (const instance of LEMMY) {
    let fromInstance = 0;
    for (let page = 1; page <= 60 && fromInstance < perInstance; page++) {
      let body;
      try {
        body = await get(`https://${instance}/api/v3/post/list` +
          `?limit=50&page=${page}&sort=New&type_=All`, { retries: 1 });
      } catch {
        break;
      }
      const posts = body?.posts ?? [];
      if (!posts.length) break;
      for (const entry of posts) {
        const url = entry?.post?.url;
        if (url) {
          yield url;
          fromInstance++;
          seen++;
        }
        // Post bodies quote links as well, and those skew towards shopping.
        for (const found of String(entry?.post?.body ?? "").matchAll(URL_IN_TEXT)) {
          yield found[0];
          fromInstance++;
          seen++;
        }
      }
      progress("lemmy", seen, target);
    }
    if (seen >= target) return;
  }
}

/**
 * Image URLs from Wikimedia Commons. Long percent-encoded filenames on a CDN
 * host — the shape an image share actually has, and one nothing else here
 * produces.
 */
export async function* commons(target, { get, progress, sleep, deadline = 1500000, cursors = {} }) {
  const until = Date.now() + deadline;
  let cont = cursors.commons ?? "";
  let seen = 0;
  let failures = 0;

  // Time-boxed: Wikimedia throttles this hard enough that chasing a large
  // target would take hours. A few thousand image URLs is enough to cover the
  // shape; the rest of the corpus supplies the volume.
  while (seen < target && failures < 6 && Date.now() < until) {
    let body;
    try {
      body = await get("https://commons.wikimedia.org/w/api.php?action=query" +
        "&list=allimages&ailimit=500&aiprop=url&format=json&formatversion=2" +
        (cont ? `&aicontinue=${encodeURIComponent(cont)}` : ""), { retries: 2 });
    } catch {
      // Wikimedia rate-limits an unauthenticated run, and a heavy Wikipedia
      // pass just before this one uses up the allowance. Backing off and
      // carrying on recovers; giving up on the first 429 loses the whole
      // source, which is what happened the first time this ran.
      failures++;
      await sleep(3000 * failures);
      continue;
    }

    const images = body?.query?.allimages ?? [];
    if (!images.length) return;
    for (const image of images) {
      if (image.url) {
        yield image.url;
        seen++;
      }
      if (image.descriptionurl) {
        yield image.descriptionurl;
        seen++;
      }
    }
    progress("commons", seen, target);
    cont = body?.continue?.aicontinue;
    if (cont) cursors.commons = cont;
    if (!cont) return;
    await sleep(150); // stay under the rate limit rather than discover it
  }
}

/* -------------------------------------------------------------------------- *
 * Really-shared links: Reddit and Mastodon
 *
 * These are links people put in front of other people TODAY — outbound
 * submissions, link cards, and the posts' own permalinks. This is the
 * closest a scripted run gets to "what would someone paste into a
 * shortener": youtube videos, x.com posts, instagram reels, news, shops.
 * (Twitter/X and Instagram have no scriptable public read API; their URL
 * shapes arrive here as the TARGETS of Reddit and Mastodon shares.)
 * -------------------------------------------------------------------------- */

/**
 * Listing feeds, rotated: r/all newest plus the big time-window tops. RSS,
 * not the JSON API — Reddit answers the JSON endpoints from datacenter IPs
 * with a plain 403, but serves the same listings as Atom feeds.
 */
const REDDIT_LISTINGS = [
  "r/all/new/.rss?limit=100",
  "r/all/top/.rss?t=day&limit=100",
  "r/all/top/.rss?t=week&limit=100",
  "r/all/top/.rss?t=month&limit=100",
  "r/all/top/.rss?t=year&limit=100",
  "r/popular/hot/.rss?limit=100",
];

/**
 * Reddit serves these feeds to curl but answers Node's fetch with 403 (it
 * discriminates by HTTP client, not by request), so this one source shells
 * out to curl — a plain, honestly-identified feed client asking for a feed.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function curlText(url) {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve, reject) => {
    execFile("curl", [
      "-s", "--fail", "--max-time", "30",
      "-A", "clent-corpus/2.1 (+https://github.com/jar99/ClentLinkShort)",
      url,
    ], { maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout));
  });
}

/**
 * Reddit link posts: each entry's permalink plus every URL written in its
 * body — for a link post that includes the submitted destination. Deadline-
 * budgeted and politely paced; it contributes shapes, not volume.
 */
export async function* reddit(target, { progress, sleep, deadline = 900000 }) {
  const until = Date.now() + deadline;
  let seen = 0;
  let failures = 0;
  for (let round = 0; seen < target && failures < 6 && Date.now() < until; round++) {
    const listing = REDDIT_LISTINGS[round % REDDIT_LISTINGS.length];
    let after = "";
    for (let page = 0; page < 10 && seen < target && Date.now() < until; page++) {
      let xml;
      try {
        xml = await curlText(`https://www.reddit.com/${listing}` +
          (after ? `&after=${after}` : ""));
      } catch {
        failures++;
        await sleep(10000); // back off hard; the limiter is per-IP
        break;
      }
      // Atom: permalinks ride <link href>, outbound destinations ride the
      // entry body's escaped HTML; ids page the listing like the JSON API.
      let inPage = 0;
      for (const match of xml.matchAll(/<link href="([^"]+)"/g)) {
        yield unescapeXml(match[1]);
        seen++;
        inPage++;
      }
      for (const match of xml.matchAll(/<content[^>]*>([\s\S]*?)<\/content>/g)) {
        for (const found of unescapeXml(match[1]).matchAll(/href="(https?:\/\/[^"]+)"/g)) {
          yield unescapeXml(found[1]);
          seen++;
        }
      }
      progress("reddit", seen, target);
      const ids = [...xml.matchAll(/<id>(t3_[a-z0-9]+)<\/id>/g)];
      after = ids.length ? ids[ids.length - 1][1] : "";
      if (!after || !inPage) break;
      await sleep(2500); // ~24 requests a minute keeps the limiter quiet
    }
  }
}

/** General-purpose and topical instances; together they see most of the fediverse. */
const MASTODON = [
  "mastodon.social", "fosstodon.org", "mstdn.social", "mas.to",
  "hachyderm.io", "mastodon.online", "infosec.exchange", "mastodon.world",
  "techhub.social", "mstdn.party", "mastodon.art", "mastodonapp.uk",
  "aus.social", "mastodon.nz", "toot.community", "social.vivaldi.net",
];

/**
 * Mastodon public timelines: each status contributes its own permalink, its
 * link-card target when it has one, and any URL written in the post body.
 * All instances page concurrently — they are separate servers with separate
 * rate limits.
 */
export async function* mastodon(target, { get, progress, sleep }) {
  const perInstance = Math.ceil(target / MASTODON.length);

  yield* channel(target, "mastodon", progress,
    MASTODON.map((instance) => async (push, stopped) => {
      let maxId = "";
      let fromInstance = 0;
      while (fromInstance < perInstance && !stopped()) {
        let statuses;
        try {
          statuses = await get(`https://${instance}/api/v1/timelines/public` +
            `?limit=40${maxId ? `&max_id=${maxId}` : ""}`, { retries: 1 });
        } catch {
          return; // one instance down is fine; the rest are paging
        }
        if (!Array.isArray(statuses) || !statuses.length) return;
        for (const status of statuses) {
          if (status?.url) { push(status.url); fromInstance++; }
          if (status?.card?.url) { push(status.card.url); fromInstance++; }
          const content = String(status?.content ?? "");
          for (const match of content.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
            push(match[1].replace(/&amp;/g, "&"));
            fromInstance++;
          }
        }
        maxId = statuses[statuses.length - 1]?.id ?? "";
        if (!maxId) return;
        await sleep(400); // well inside 300 requests per 5 minutes
      }
    }));
}

/* -------------------------------------------------------------------------- *
 * Deep links on the sites people care about: Fandom wikis and targeted
 * per-domain mining
 * -------------------------------------------------------------------------- */

/** Big Fandom communities across film, TV, games, anime and comics. */
const FANDOM_WIKIS = [
  "starwars", "harrypotter", "marvel", "dc", "memory-alpha", "minecraft",
  "elderscrolls", "fallout", "leagueoflegends", "naruto", "onepiece",
  "pokemon", "disney", "gameofthrones", "zelda", "warframe", "terraria",
  "genshin-impact", "simpsons", "southpark", "lotr", "dune", "stargate",
  "tardis", "villains", "heroes", "dragonball", "bleach", "jojo",
  "yugioh", "digimon", "sonic", "residentevil", "finalfantasy", "halo",
  "masseffect", "witcher", "cyberpunk", "runescape", "wowpedia",
  "attackontitan", "deathnote", "hunterxhunter", "myheroacademia",
  "kimetsu-no-yaiba", "swordartonline", "fairytail", "fma", "tokyoghoul",
  "jujutsu-kaisen", "chainsaw-man", "spy-x-family", "haikyuu", "gta",
  "callofduty", "assassinscreed", "godofwar", "darksouls", "eldenring",
  "hollowknight", "stardewvalley", "subnautica", "satisfactory",
  "rimworld", "borderlands", "bioshock", "dishonored", "danganronpa",
  "megamitensei", "xenoblade", "fireemblem", "supersmashbros",
  "deadbydaylight", "apexlegends", "overwatch", "valorant", "starcraft",
  "diablo", "hearthstone", "criticalrole", "rickandmorty",
  "strangerthings", "thewalkingdead", "breakingbad",
];

/**
 * Real article URLs from Fandom wikis, via each community's own MediaWiki
 * API — page titles become the exact /wiki/ URLs Fandom serves, capitals,
 * quotes, parentheses and all, which is precisely the messy shape a codec
 * needs to prove itself on. Six communities page at once; each is its own
 * subdomain, and Fandom serves them from one CDN that tolerates this fine.
 */
export async function* fandom(target, { get, progress, sleep, cursors = {} }) {
  const CONCURRENT = 6;
  const perWiki = Math.ceil(target / FANDOM_WIKIS.length);
  let nextWiki = 0;
  // Per-community continuation: the next run pages DEEPER instead of
  // re-fetching (and deduping away) everything already collected. null
  // marks a community fully walked.
  const state = (cursors.fandom ??= {});

  yield* channel(target, "fandom", progress,
    Array.from({ length: CONCURRENT }, () => async (push, stopped) => {
      while (!stopped()) {
        const at = nextWiki++;
        if (at >= FANDOM_WIKIS.length) return;
        const community = FANDOM_WIKIS[at];
        if (state[community] === null) continue; // exhausted on a prior run
        let cont = state[community] ?? "";
        let fromWiki = 0;
        while (fromWiki < perWiki && !stopped()) {
          let body;
          try {
            body = await get(`https://${community}.fandom.com/api.php?action=query` +
              "&list=allpages&aplimit=500&format=json&formatversion=2" +
              (cont ? `&apcontinue=${encodeURIComponent(cont)}` : ""), { retries: 1 });
          } catch {
            break; // one community down should not stop the sweep
          }
          const pages = body?.query?.allpages ?? [];
          if (!pages.length) { state[community] = null; break; }
          for (const page of pages) {
            if (!page.title) continue;
            // Fandom's own URL spelling: spaces become underscores; slashes
            // and colons stay; the rest percent-encodes.
            const slug = encodeURIComponent(page.title.replace(/ /g, "_"))
              .replace(/%2F/gi, "/").replace(/%3A/gi, ":");
            push(`https://${community}.fandom.com/wiki/${slug}`);
            fromWiki++;
          }
          cont = body?.continue?.apcontinue;
          if (!cont) { state[community] = null; break; }
          state[community] = cont;
          await sleep(120);
        }
      }
    }));
}

/**
 * The domains worth mining on purpose: asked-for sites whose deep links are
 * underrepresented in listing-driven sources.
 */
const TARGET_DOMAINS = [
  "imdb.com", "fandom.com", "linkedin.com", "instagram.com", "twitter.com",
  "x.com", "youtube.com", "youtu.be", "facebook.com", "tiktok.com",
  "medium.com", "substack.com", "goodreads.com", "rottentomatoes.com",
  "open.spotify.com", "soundcloud.com", "letterboxd.com", "discogs.com",
  "twitch.tv", "flickr.com", "imgur.com", "patreon.com", "kickstarter.com",
];

/**
 * Wikipedia's citation index, filtered per domain: every URL is a real
 * link someone cited, and the euquery filter turns the index into a
 * per-site deep-link mine — IMDb titles, LinkedIn profiles, Instagram
 * posts, X statuses. Paced gently: Wikimedia rate-limits by IP, and this
 * source backs off rather than pushing into a 429 wall.
 */
export async function* targeted(target, { get, progress, sleep }) {
  const perDomain = Math.ceil(target / TARGET_DOMAINS.length);
  let total = 0;
  let strikes = 0;
  for (const domain of TARGET_DOMAINS) {
    let cont = "";
    let fromDomain = 0;
    while (fromDomain < perDomain && strikes < 5) {
      let body;
      try {
        body = await get("https://en.wikipedia.org/w/api.php?action=query" +
          `&list=exturlusage&euquery=${encodeURIComponent(domain)}` +
          "&eulimit=500&format=json&formatversion=2" +
          (cont ? `&eucontinue=${encodeURIComponent(cont)}` : ""), { retries: 1 });
      } catch {
        strikes++;
        await sleep(30000 * strikes); // the limiter cools on a scale of minutes
        continue;
      }
      const rows = body?.query?.exturlusage ?? [];
      if (!rows.length) break;
      for (const row of rows) {
        if (row.url) {
          yield row.url;
          fromDomain++;
          total++;
        }
      }
      progress("targeted", total, target);
      cont = body?.continue?.eucontinue;
      if (!cont) break;
      await sleep(700);
    }
    if (total >= target || strikes >= 5) return;
  }
}

/* -------------------------------------------------------------------------- *
 * High-volume registries: DOIs, packages, archive items
 *
 * Uniform in shape individually, but the shapes are real and shared daily —
 * a paper's DOI, a package page, an archive item — and the registries
 * publish fast, generous, cursor-paged APIs.
 * -------------------------------------------------------------------------- */

/**
 * Crossref: the DOI registry, 185M works. Every URL is a real citable
 * link of the exact form people paste into papers, posts and READMEs.
 */
export async function* crossref(target, { get, progress, sleep, cursors = {} }) {
  let cursor = cursors.crossref ?? "*";
  let seen = 0;
  let failures = 0;
  while (seen < target && failures < 4) {
    let body;
    try {
      body = await get("https://api.crossref.org/works?rows=1000&select=URL" +
        `&cursor=${encodeURIComponent(cursor)}`, { retries: 1 });
    } catch {
      failures++;
      await sleep(3000);
      continue;
    }
    const items = body?.message?.items ?? [];
    if (!items.length) return;
    for (const item of items) {
      if (item.URL) {
        yield item.URL;
        seen++;
      }
    }
    progress("crossref", seen, target);
    cursor = body?.message?.["next-cursor"];
    if (!cursor) return;
    cursors.crossref = cursor;
    await sleep(150); // their "polite" pool asks for moderation, not silence
  }
}

/**
 * npm package pages, via the registry's public CouchDB view. Names become
 * the npmjs.com URLs people paste into issues and chat, scoped packages'
 * "@" and "/" included.
 */
export async function* npmjs(target, { get, progress, cursors = {} }) {
  let startkey = cursors.npmjs ?? "";
  let seen = 0;
  while (seen < target) {
    let body;
    try {
      // No skip parameter — the replicate endpoint rejects it. The repeated
      // boundary row is dropped here instead.
      body = await get("https://replicate.npmjs.com/_all_docs?limit=5000" +
        (startkey ? `&startkey=${encodeURIComponent(JSON.stringify(startkey))}` : ""),
      { retries: 1 });
    } catch {
      return;
    }
    let rows = body?.rows ?? [];
    if (startkey && rows.length && rows[0]?.id === startkey) rows = rows.slice(1);
    if (!rows.length) return;
    for (const row of rows) {
      if (row.id && !row.id.startsWith("_")) {
        yield `https://www.npmjs.com/package/${row.id}`;
        seen++;
      }
    }
    progress("npm", seen, target);
    startkey = rows[rows.length - 1]?.id;
    if (!startkey) return;
    cursors.npmjs = startkey;
  }
}

/**
 * PyPI project pages, from the simple index — one request lists every
 * project on the index; the target-sized slice is spread across it rather
 * than taken alphabetically from the front.
 */
export async function* pypi(target, { get, progress }) {
  let text;
  try {
    const response = await get("https://pypi.org/simple/", { json: false });
    text = await response.text();
  } catch {
    return;
  }
  const names = [...text.matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
  const step = Math.max(1, Math.floor(names.length / target));
  let seen = 0;
  for (let i = 0; i < names.length && seen < target; i += step) {
    yield `https://pypi.org/project/${names[i]}/`;
    seen++;
    if (seen % 20000 === 0) progress("pypi", seen, target);
  }
}

/**
 * Google News feeds: the front page plus topic sections across several
 * locales. Each item carries the news.google.com share URL — the long
 * opaque shape people actually paste — and the description links to the
 * source article, so both populations land in the corpus.
 */
const GOOGLE_NEWS = (() => {
  const locales = [
    ["en-US", "US", "US:en"], ["en-GB", "GB", "GB:en"], ["de", "DE", "DE:de"],
    ["fr", "FR", "FR:fr"], ["es-419", "US", "US:es-419"], ["ja", "JP", "JP:ja"],
  ];
  const topics = [
    "WORLD", "NATION", "BUSINESS", "TECHNOLOGY", "ENTERTAINMENT",
    "SCIENCE", "SPORTS", "HEALTH",
  ];
  const feeds = [];
  for (const [hl, gl, ceid] of locales) {
    feeds.push(`https://news.google.com/rss?hl=${hl}&gl=${gl}&ceid=${ceid}`);
    for (const topic of topics) {
      feeds.push("https://news.google.com/rss/headlines/section/topic/" +
        `${topic}?hl=${hl}&gl=${gl}&ceid=${ceid}`);
    }
  }
  return feeds;
})();

/** Headlines from Google News, four feeds at a time. */
export async function* googlenews(target, { get, progress }) {
  let nextFeed = 0;
  yield* channel(target, "googlenews", progress,
    Array.from({ length: 4 }, () => async (push, stopped) => {
      while (!stopped()) {
        const at = nextFeed++;
        if (at >= GOOGLE_NEWS.length) return;
        let xml;
        try {
          const response = await get(GOOGLE_NEWS[at], { json: false, retries: 1 });
          xml = await response.text();
        } catch {
          continue; // one dead feed shouldn't stop the sweep
        }
        for (const url of urlsFromFeed(xml)) push(url);
      }
    }));
}

/** Internet Archive item pages, spread across media types. */
export async function* archiveitems(target, { get, progress, sleep }) {
  const KINDS = ["texts", "movies", "audio", "software", "image"];
  const perKind = Math.ceil(target / KINDS.length);
  let total = 0;
  for (const kind of KINDS) {
    let page = 1;
    let fromKind = 0;
    while (fromKind < perKind) {
      let body;
      try {
        body = await get("https://archive.org/advancedsearch.php" +
          `?q=mediatype:${kind}&fl%5B%5D=identifier&rows=1000&page=${page}&output=json`,
        { retries: 1 });
      } catch {
        break;
      }
      const docs = body?.response?.docs ?? [];
      if (!docs.length) break;
      for (const doc of docs) {
        if (doc.identifier) {
          yield `https://archive.org/details/${doc.identifier}`;
          fromKind++;
          total++;
        }
      }
      progress("archive", total, target);
      page++;
      await sleep(300);
    }
    if (total >= target) return;
  }
}
