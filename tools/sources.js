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
];

/** Stack Exchange sites, for links people actually paste into questions. */
const SE_SITES = [
  "stackoverflow", "serverfault", "superuser", "askubuntu", "unix",
  "security", "math", "physics", "english", "electronics",
];

/**
 * External links cited in articles, across many language editions. Deep,
 * messy, and full of URLs typed by hand a decade ago.
 */
export async function* wikipedia(target, { get, progress }) {
  const perWiki = Math.ceil(target / WIKIS.length);
  let total = 0;

  for (const lang of WIKIS) {
    let cont = "";
    let fromWiki = 0;
    while (fromWiki < perWiki) {
      const url = `https://${lang}.wikipedia.org/w/api.php?action=query` +
        "&list=exturlusage&eulimit=500&format=json&formatversion=2" +
        (cont ? `&eucontinue=${encodeURIComponent(cont)}` : "");
      let body;
      try {
        body = await get(url);
      } catch {
        break; // a single wiki being unavailable should not stop the run
      }
      const rows = body?.query?.exturlusage ?? [];
      if (!rows.length) break;
      for (const row of rows) {
        if (row.url) {
          yield row.url;
          fromWiki++;
          total++;
        }
      }
      progress("wikipedia", total, target);
      cont = body?.continue?.eucontinue;
      if (!cont) break;
    }
    if (total >= target) return;
  }
}

/**
 * Links submitted to Hacker News. Algolia caps a query at 1000 hits, so walk
 * backwards through time using the oldest timestamp of each page as the next
 * upper bound.
 */
export async function* hackernews(target, { get, progress }) {
  let before = Math.floor(Date.now() / 1000);
  let seen = 0;
  while (seen < target) {
    const body = await get("https://hn.algolia.com/api/v1/search_by_date?tags=story" +
      `&hitsPerPage=1000&numericFilters=created_at_i<${before}`);
    const hits = body?.hits ?? [];
    if (!hits.length) return;
    for (const hit of hits) {
      if (hit.url) {
        yield hit.url;
        seen++;
      }
    }
    progress("hn", seen, target);
    const oldest = Math.min(...hits.map((h) => h.created_at_i).filter(Number.isFinite));
    if (!Number.isFinite(oldest) || oldest >= before) return;
    before = oldest;
  }
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
export async function* commons(target, { get, progress, sleep, deadline = 420000 }) {
  const until = Date.now() + deadline;
  let cont = "";
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
    if (!cont) return;
    await sleep(150); // stay under the rate limit rather than discover it
  }
}
