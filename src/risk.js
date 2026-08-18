/**
 * Destination risk: the shapes phishing links take.
 *
 * Pure policy over a parsed URL — no codec dependency in either direction.
 * (idn.js is the one import: name analysis, not encoding.)
 * The page consults this before auto-following a decoded destination.
 *
 * @module risk
 */

/** Nothing worth mentioning. */
export const RISK_NONE = 0;
/** Worth showing, not worth stopping for. */
export const RISK_NOTE = 1;
/** Stop and make a human look before going there. */
export const RISK_BLOCK = 2;

import { deceptiveIdn } from "./idn.js";

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Names worth wearing. Not a popularity ranking — these are the sites a
 * credential-phishing link pretends to be, which is a different and much
 * shorter list than the busiest sites on the web.
 *
 * Deliberately not imported from the host dictionary: that table is ordered
 * by how often a domain is *shared*, which is not the same question, and
 * risk.js stays free of codec dependencies in both directions.
 */
const IMPERSONATED = Object.freeze([
  "paypal.com", "apple.com", "microsoft.com", "google.com", "amazon.com",
  "facebook.com", "instagram.com", "netflix.com", "linkedin.com", "dropbox.com",
  "coinbase.com", "binance.com", "chase.com", "wellsfargo.com", "bankofamerica.com",
  "hsbc.com", "barclays.co.uk", "steampowered.com", "discord.com", "roblox.com",
  "office.com", "outlook.com", "icloud.com", "whatsapp.com", "telegram.org",
  "github.com", "gov.uk", "irs.gov", "usps.com", "dhl.com",
]);

/**
 * Does the tail after a brand look like a country's slice of it, rather than
 * somewhere else entirely? "google.com" inside "www.google.com.au" is Google;
 * inside "paypal.com.evil.example" it is bait. The difference is what follows:
 * a registry suffix is one or two very short labels.
 */
const suffixTail = (labels) =>
  labels.length > 0 && labels.length <= 2 && labels.every((l) => l.length <= 3);

/**
 * Look for the shapes phishing links take.
 *
 * A redirector is a gift to a phisher: the destination is invisible until it
 * has already happened, and the link wears this site's domain. The scheme
 * allowlist stops a payload from running code, but it does nothing about a
 * payload that points somewhere deliberately deceptive, and that is a
 * different problem needing a different answer.
 *
 * Nothing here is a verdict on whether a site is malicious — that can't be
 * known from a URL. These are the properties a normal shared link almost
 * never has and a deceptive one often does, so the page shows the destination
 * and waits instead of going there quietly.
 *
 * The English message ships with each reason so this module stays useful on
 * its own — in tests, in Node, in a fork that never loads the page. The page
 * prefers a translation of `code` and falls back to `message`, so `values`
 * carries the placeholders the translated string needs. Both must always say
 * the same thing.
 *
 * @param {URL} url
 * @returns {{level: number, reasons: Array<{code: string, level: number,
 *   message: string, values?: Record<string, string>}>}}
 */
export function assess(url) {
  const reasons = [];
  const add = (code, level, message, values) =>
    reasons.push({ code, level, message, values });

  // "https://paypal.com@evil.example/" reads as PayPal and goes to evil.
  // The oldest trick there is, and still the most effective.
  if (url.username || url.password) {
    add("userinfo", RISK_BLOCK,
      `The part before the "@" is not the destination. This link actually goes to ${url.hostname}.`,
      { host: url.hostname });
  }

  // An internationalised name is a valid, safe URL and gets opened like any
  // other. What is worth stopping for is the narrower thing punycode enables:
  // a label mixing scripts so non-Latin characters can pose as Latin ones,
  // like the Cyrillic a in "pаypal". idn.js decodes the name and counts its
  // scripts, so Japanese, Chinese, Cyrillic and emoji domains pass untouched
  // and only the deceptive shape is called deceptive.
  if (deceptiveIdn(url.hostname)) {
    add("homograph", RISK_BLOCK,
      "This address mixes alphabets, so some characters may not be the " +
      "letters they look like.");
  }

  // "paypal.com.evil.example" reads as PayPal to anyone scanning left to
  // right, and the real domain is the part they stop reading before. The
  // brand has to appear as whole labels — matching a substring would flag
  // "notpaypal.com.au" and miss nothing real.
  const labels = url.hostname.split(".");
  for (const brand of IMPERSONATED) {
    const wanted = brand.split(".");
    for (let i = 0; i + wanted.length <= labels.length; i++) {
      if (wanted.some((label, k) => labels[i + k] !== label)) continue;
      const rest = labels.slice(i + wanted.length);
      // Ending on the brand is the brand, or a subdomain of it. Ending on a
      // registry tail is that brand's local site. Anything else is wearing it.
      if (rest.length === 0 || suffixTail(rest)) break;
      // Measured over the whole 4.3M corpus this fires on 5 URLs, all of the
      // form brand.com.<cdn> (edgesuite, edgekey, nyud) — which is the very
      // shape being described, just with a benign operator. An interstitial
      // on one link in a million is the right side of that trade.
      add("impersonation", RISK_BLOCK,
        `This address contains "${brand}", but the site it actually opens is ` +
        `${url.hostname}.`,
        { brand, host: url.hostname });
      break;
    }
  }

  if (IPV4.test(url.hostname) || url.hostname.startsWith("[")) {
    add("ip-literal", RISK_BLOCK,
      "This link points at a raw IP address rather than a named site.");
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    add("port", RISK_NOTE,
      `It connects on port ${url.port} rather than the usual one.`, { port: url.port });
  }

  if (url.protocol === "http:") {
    add("insecure", RISK_NOTE, "The connection is plain HTTP, so it isn't encrypted.");
  }

  return {
    level: reasons.reduce((worst, r) => Math.max(worst, r.level), RISK_NONE),
    reasons,
  };
}
