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
