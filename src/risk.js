/**
 * Destination risk: the shapes phishing links take.
 *
 * Pure policy over a parsed URL — no codec dependency in either direction.
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

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

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
 * @param {URL} url
 * @returns {{level: number, reasons: Array<{code: string, level: number, message: string}>}}
 */
export function assess(url) {
  const reasons = [];
  const add = (code, level, message) => reasons.push({ code, level, message });

  // "https://paypal.com@evil.example/" reads as PayPal and goes to evil.
  // The oldest trick there is, and still the most effective.
  if (url.username || url.password) {
    add("userinfo", RISK_BLOCK,
      `The part before the "@" is not the destination. This link actually goes to ${url.hostname}.`);
  }

  // Punycode is how a homograph attack survives being written down:
  // "xn--pypal-4ve.com" renders as something very close to "paypal.com".
  const punycode = url.hostname.split(".").filter((label) => label.startsWith("xn--"));
  if (punycode.length) {
    add("punycode", RISK_BLOCK,
      "This address uses characters that can look like a different name.");
  }

  if (IPV4.test(url.hostname) || url.hostname.startsWith("[")) {
    add("ip-literal", RISK_BLOCK,
      "This link points at a raw IP address rather than a named site.");
  }

  if (url.port && url.port !== "80" && url.port !== "443") {
    add("port", RISK_NOTE, `It connects on port ${url.port} rather than the usual one.`);
  }

  if (url.protocol === "http:") {
    add("insecure", RISK_NOTE, "The connection is plain HTTP, so it isn't encrypted.");
  }

  return {
    level: reasons.reduce((worst, r) => Math.max(worst, r.level), RISK_NONE),
    reasons,
  };
}
