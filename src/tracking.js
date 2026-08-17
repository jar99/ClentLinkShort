/**
 * Tracking-parameter policy: which query parameters are removed when the
 * "remove tracking" switch is on.
 *
 * This is the only transformation in the codec that changes the destination
 * rather than re-encoding it, which is why it is a visible switch and is
 * reported separately by analyze().
 *
 * @module tracking
 */

/**
 * Parameters removed on every host.
 *
 * The list errs towards leaving things alone. Anything that might select
 * what you actually see is not here: Amazon's `th` and `psc` pick a product
 * variant, and a bare `ref` is a real route parameter on plenty of sites even
 * though Amazon uses it for tracking. Affiliate tags (`tag`, `campid`,
 * `ascsubtag`) *are* removed — they are tracking identifiers, and the switch
 * is there for anyone who is deliberately sharing their own.
 */
export const TRACKING_PARAMS = new RegExp("^(?:" + [
  // analytics and ad networks
  "utm_[\\w-]*", "fbclid", "gclid", "dclid", "gbraid", "wbraid", "msclkid",
  "yclid", "ttclid", "twclid", "epik", "irclickid", "mc_[ce]id", "_hsenc",
  "_hsmi", "hsa_[\\w-]+", "_ga", "_gl", "s_kwcid", "ef_id", "vero_id",
  "oly_(?:enc|anon)_id", "piwik_[\\w-]+", "pk_[\\w-]+", "at_[\\w-]+", "__s",
  "spm", "scm", "_openstat", "yclid", "rb_clickid", "cmpid", "ncid", "sfnsn",
  // social
  "igshid", "igsh", "share_source", "share_app_id", "share_id", "ref_src",
  "ref_url", "rdt", "si", "_branch_match_id", "_branch_referrer", "xmt",
  "is_from_webapp", "sender_device", "web_id", "social_share", "smid",
  // video
  "pp", "ab_channel",
  // shopping and marketplaces
  "pd_rd_[\\w-]+", "pf_rd_[\\w-]+", "linkCode", "linkId", "ascsubtag", "tag",
  "creativeASIN", "creative", "camp", "qid", "sr", "sprefix", "crid",
  "content-id", "dib", "dib_tag", "_trkparms", "_trksid", "campid",
  "customid", "toolid", "mkevt", "mkcid", "mkrid", "click_key", "click_sum",
  "frs", "sts", "organic_search_click", "athbdg", "adsRedirect", "veh",
  "irgwc", "sourceid", "affid", "afsrc", "srsltid",
].join("|") + ")$", "i");

/**
 * Parameters that are only safe to remove on particular hosts.
 *
 * `s` and `t` are how X marks a shared link, and `trk` is LinkedIn's — but
 * one-letter and three-letter names like those are ordinary search or state
 * parameters everywhere else, so removing them globally would quietly break
 * links. Scoping them keeps the aggressive removal without the collateral.
 *
 * @type {ReadonlyArray<{host: RegExp, params: RegExp}>}
 */
export const TRACKING_BY_HOST = Object.freeze([
  { host: /(?:^|\.)(?:twitter|x)\.com$/i, params: /^(?:s|t)$/i },
  { host: /(?:^|\.)(?:youtube\.com|youtu\.be)$/i, params: /^(?:feature|kw|index)$/i },
  { host: /(?:^|\.)amazon\.[a-z.]+$/i, params: /^(?:ref|_encoding|smid|keywords)$/i },
  { host: /(?:^|\.)reddit\.com$/i, params: /^(?:ref|ref_source|correlation_id|share_id)$/i },
  { host: /(?:^|\.)linkedin\.com$/i, params: /^(?:trk|trackingId|originalSubdomain|lipi)$/i },
  { host: /(?:^|\.)facebook\.com$/i, params: /^(?:mibextid|extid|rdid)$/i },
  { host: /(?:^|\.)instagram\.com$/i, params: /^(?:img_index|hl)$/i },
  { host: /(?:^|\.)(?:ebay|etsy)\.[a-z.]+$/i, params: /^(?:_from|hash|var|ref)$/i },
  { host: /(?:^|\.)(?:walmart|target|bestbuy)\.com$/i, params: /^(?:from|selectedSellerId|sid)$/i },
  { host: /(?:^|\.)aliexpress\.[a-z.]+$/i, params: /^(?:sk|aff_[\w]+|terminal_id|algo_[\w]+)$/i },

  // `ref` is the one people ask for most, and it cannot go in the global list.
  // Measured over the corpus it appears on 0.05% of URLs, and the values are
  // things like "Luuk.+23:26-49", "Matt.+6:1" and "495-99-8" — Bible verses,
  // CAS registry numbers, page selectors. Removing it globally would break
  // those links to save a handful of characters on the sites where it really
  // is tracking. So it is removed on those sites, by name.
  {
    host: /(?:^|\.)(?:temu|shein|wayfair|newegg|chewy|nordstrom|macys|costco|otto|zalando|asos|johnlewis|argos|ikea|homedepot|lowes|sephora|rakuten|mercadolibre|alibaba|taobao|banggood|wish)\.[a-z.]+$/i,
    params: /^(?:ref|refer|referrer|source|from|channel|spm_id|_pid)$/i,
  },
  {
    host: /(?:^|\.)(?:tiktok|snapchat|pinterest|threads|bsky|mastodon\.social|tumblr|vk|weibo)\.[a-z.]+$/i,
    params: /^(?:ref|ref_src|source|invite|from)$/i,
  },
  {
    host: /(?:^|\.)(?:substack|medium|patreon|kickstarter|gofundme|eventbrite)\.[a-z.]+$/i,
    params: /^(?:ref|source|utm|r|triedRedirect)$/i,
  },
  { host: /(?:^|\.)(?:booking|expedia|airbnb|tripadvisor)\.[a-z.]+$/i,
    params: /^(?:aid|label|sid|source_impression_id|federated_search_id|search_mode)$/i },
]);

/**
 * Remove known tracking parameters in place.
 * @param {URL} url
 * @returns {string[]} the parameter names removed
 */
/**
 * Path rewrites for sites that bury tracking in the path itself. Amazon is
 * the canonical case: the title slug and the `/ref=…` crumb around
 * `/dp/<ASIN>` are decoration — `/dp/<ASIN>` alone lands on the same page.
 * Only applied under stripTracking, which is already the "may change the
 * URL's bytes" switch.
 *
 * @type {ReadonlyArray<{host: RegExp, match: RegExp, rewrite: string, label: string}>}
 */
export const PATH_BY_HOST = Object.freeze([
  {
    host: /(?:^|\.)amazon\.[a-z.]+$/i,
    match: /^(?:\/[^/]+)*?\/dp\/([A-Z0-9]{9,10})(?:\/.*)?$/i,
    rewrite: "/dp/$1",
    label: "amazon path clutter",
  },
  {
    host: /(?:^|\.)amazon\.[a-z.]+$/i,
    match: /^\/gp\/product\/([A-Z0-9]{9,10})(?:\/.*)?$/i,
    rewrite: "/dp/$1",
    label: "amazon path clutter",
  },
]);

export function stripTracking(url) {
  const scoped = TRACKING_BY_HOST
    .filter((rule) => rule.host.test(url.hostname))
    .map((rule) => rule.params);

  const hits = [...url.searchParams.keys()].filter((key) =>
    TRACKING_PARAMS.test(key) || scoped.some((params) => params.test(key)));

  for (const key of hits) url.searchParams.delete(key);
  // Re-serialising an emptied query leaves a bare "?" behind.
  if (![...url.searchParams].length) url.search = "";

  for (const rule of PATH_BY_HOST) {
    if (!rule.host.test(url.hostname) || !rule.match.test(url.pathname)) continue;
    const cleaned = url.pathname.replace(rule.match, rule.rewrite);
    if (cleaned !== url.pathname) {
      url.pathname = cleaned;
      hits.push(rule.label);
    }
  }
  return hits;
}
