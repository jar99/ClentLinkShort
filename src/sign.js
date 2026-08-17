/**
 * Tamper resistance for links.
 *
 * Two different things, with two different strengths, and it matters which
 * one you have:
 *
 *   Integrity check   A truncated SHA-256 of the payload, no key. Catches a
 *                     link that got clipped, mangled by a chat client, or
 *                     mistyped. It catches *accidents*. Anyone editing a link
 *                     on purpose can recompute it, so it is not security and
 *                     is not described as such anywhere in this project.
 *
 *   Signature         HMAC-SHA-256 under a passphrase, truncated. Proves the
 *                     link was made by someone who knows the passphrase. That
 *                     is a real guarantee and also a limited one, spelled out
 *                     below.
 *
 * What a signature does not do:
 *
 *   - It does not identify a person. Everyone holding the passphrase can sign,
 *     so it proves membership of that group, nothing finer.
 *   - It does not stop anyone stripping it. A forger can hand over an unsigned
 *     link instead — which is why the page shows signed and unsigned links
 *     differently, and why the recipient has to care about the difference.
 *   - It does not protect a link you publish to the world. If the passphrase
 *     is public, so is the ability to sign.
 *
 * It is worth having when a group shares a passphrase out of band and wants to
 * know a link came from inside the group. Public-key signatures would fix the
 * identity problem, but the smallest useful signature is 64 bytes — 86
 * characters — on a payload that averages 30, so it would be the entire link.
 * The honest trade was made in favour of the short one, and written down.
 *
 * Wire form: the tag goes after the payload, separated by a full stop, with a
 * one-character marker. `#<payload>.c<tag>` or `#<payload>.h<tag>`. The
 * payload itself is untouched, so a signed and an unsigned link to the same
 * place share a prefix, and stripping the tag cannot change the destination.
 */

import { B64, ClentError } from "./bits.js";

/** Marker for a keyless integrity check. */
export const TAG_CHECK = "c";
/** Marker for a passphrase signature. */
export const TAG_SIGNED = "h";

/** Whether this runtime can hash. Without it, tags cannot be made or checked. */
export const canSign = typeof crypto !== "undefined" && !!crypto?.subtle;

const utf8 = new TextEncoder();

/** Pack bytes into Base64url characters at 6 bits each, to `chars` length. */
function pack(bytes, chars) {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 6 && out.length < chars) {
      bits -= 6;
      out += B64[(acc >> bits) & 63];
    }
    acc &= (1 << bits) - 1;
    if (out.length >= chars) break;
  }
  return out;
}

/**
 * @param {string} payload
 * @param {number} chars length of the tag
 * @returns {Promise<string>}
 */
export async function checksum(payload, chars = 4) {
  if (!canSign) throw new ClentError("This browser cannot compute an integrity check.");
  const digest = await crypto.subtle.digest("SHA-256", utf8.encode(payload));
  return pack(new Uint8Array(digest), chars);
}

/**
 * @param {string} payload
 * @param {string} passphrase
 * @param {number} chars length of the tag; 16 characters is 96 bits
 * @returns {Promise<string>}
 */
export async function sign(payload, passphrase, chars = 16) {
  if (!canSign) throw new ClentError("This browser cannot sign links.");
  if (!passphrase) throw new ClentError("A passphrase is needed to sign.");
  const key = await crypto.subtle.importKey(
    "raw", utf8.encode(passphrase),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, utf8.encode(payload));
  return pack(new Uint8Array(mac), chars);
}

/**
 * Split a fragment into its payload and tag.
 * @param {string} fragment
 * @returns {{payload: string, kind: string|null, tag: string}}
 */
export function split(fragment) {
  const at = fragment.lastIndexOf(".");
  if (at === -1) return { payload: fragment, kind: null, tag: "" };
  const marker = fragment[at + 1];
  if (marker !== TAG_CHECK && marker !== TAG_SIGNED) {
    return { payload: fragment, kind: null, tag: "" };
  }
  return {
    payload: fragment.slice(0, at),
    kind: marker,
    tag: fragment.slice(at + 2),
  };
}

/**
 * @param {string} payload
 * @param {string} kind TAG_CHECK or TAG_SIGNED
 * @param {string} tag
 * @returns {string}
 */
export const join = (payload, kind, tag) => `${payload}.${kind}${tag}`;

/**
 * Constant-time-ish comparison. The tags here are public and a timing attack
 * on a client-side string compare is not a real threat, but a length-only
 * early exit is free to avoid and costs nothing to keep honest.
 */
function equal(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Check a tag against a payload.
 *
 * @param {string} payload
 * @param {string} kind
 * @param {string} tag
 * @param {string} [passphrase] required for a signature
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function verify(payload, kind, tag, passphrase) {
  if (!canSign) return { ok: false, reason: "This browser cannot check link integrity." };
  try {
    if (kind === TAG_CHECK) {
      return { ok: equal(await checksum(payload, tag.length), tag) };
    }
    if (kind === TAG_SIGNED) {
      if (!passphrase) return { ok: false, reason: "needs-passphrase" };
      return { ok: equal(await sign(payload, passphrase, tag.length), tag) };
    }
  } catch {
    return { ok: false, reason: "This link's integrity tag could not be checked." };
  }
  return { ok: false, reason: "Unknown tag type." };
}
