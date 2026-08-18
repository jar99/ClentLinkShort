/**
 * English, and the source of truth for what keys exist.
 *
 * Scope is the working parts of the page: what someone sees when they open a
 * shared link, the controls for making one, and every warning and failure. The
 * long explainer below the tool is deliberately not in here — translating an
 * essay is a writing job, not a wiring job, and pretending otherwise would put
 * a machine translation of a security warning in front of someone.
 *
 * A placeholder is {name}; see format() in i18n.js.
 *
 * The export is suffixed with the language code because the build concatenates
 * every module into one scope, where two catalogues both called MESSAGES would
 * collide. Every catalogue follows the same pattern.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const MESSAGES_EN = Object.freeze({
  "lang.name": "English",

  // The redirect view: what a link opens into.
  "r.redirecting": "Redirecting",
  "r.takingYou": "Taking you to",
  "r.where": "Where this link goes",
  "r.nothingLoaded": "Nothing has been loaded yet. Check the destination before continuing.",
  "r.check": "Check this link before continuing",
  "r.worthLook": "It has something about it worth a second look:",
  "r.openExternal": "Open this link?",
  "r.externalApp": "It opens an external app ({scheme}). Continue only if you trust it.",
  "r.signed": "This link is signed",
  "r.signedNote": "Nothing has been loaded yet. Check the signature, or continue without it.",
  "r.continue": "Continue",
  "r.makeLink": "Make a link",
  "r.passphrasePrompt": "This link is signed. Enter the passphrase to check it.",
  "r.passphrase": "passphrase",
  "r.checkButton": "Check",

  // Integrity and signatures.
  "tag.ok": "Integrity check passed — this link hasn't been altered.",
  "tag.unverified": "This browser can't check the link's integrity tag, so it is unverified.",
  "tag.altered": "This link has been altered",
  "tag.alteredNote":
    "Its integrity check doesn't match, so it isn't the link that was shared. " +
    "It may have been clipped in transit, or edited.",
  "sig.ok": "Signature verified — made by someone who knows this passphrase.",
  "sig.bad": "Signature does not match this passphrase.",

  // Failures, all of them user-showable.
  "err.damaged": "This link is damaged.",
  "err.damagedAddress": "This link is damaged — its address isn't valid.",
  "err.wrong": "Something went wrong opening this link.",
  "err.update": "Something went wrong — try editing the URL.",
  "err.notEncoded": "That couldn't be encoded.",

  // Risk reasons, shown on the interstitial.
  "risk.userinfo":
    "The part before the \"@\" is not the destination. This link actually goes to {host}.",
  "risk.homograph":
    "This address mixes alphabets, so some characters may not be the letters they look like.",
  "risk.impersonation":
    "This address contains \"{brand}\", but the site it actually opens is {host}.",
  "risk.ip-literal": "This link points at a raw IP address rather than a named site.",
  "risk.port": "It connects on port {port} rather than the usual one.",
  "risk.insecure": "The connection is plain HTTP, so it isn't encrypted.",

  // The maker.
  "m.pasteLabel": "Paste a long URL",
  "m.clean": "Remove tracking parameters",
  "m.cleanNote": "utm_*, fbclid, gclid and similar",
  "m.cleanNoDeflate":
    "utm_*, fbclid, gclid · this browser can't DEFLATE, so links will be longer",
  "m.preview": "Preview link",
  "m.previewNote": "shows the destination instead of going there",
  "m.tamper": "Tamper check",
  "m.tamperNote": "4 characters; catches a link that got clipped or edited",
  "m.style": "Link style",
  "m.styleStandard": "Standard",
  "m.styleDense": "Dense",
  "m.styleEmoji": "Emoji",
  "m.styleNotePlain": "Base64url; survives every app and clipboard",
  "m.styleNoteDense": "≈7% shorter with URL punctuation; some chat apps cut links at it",
  "m.styleNoteEmoji": "a quarter fewer characters to look at; some apps mangle emoji",
  "m.shorter": "{saved} characters shorter",
  "m.shorterCleaned1": "{saved} characters shorter, after removing 1 tracking parameter",
  "m.shorterCleaned": "{saved} characters shorter, after removing {removed} tracking parameters",
  "m.sameLength": "Exactly the same length.",
  "m.longer":
    "{longer} characters longer. This URL is already short enough that carrying " +
    "it whole costs more than it saves.",
  "m.willWarn": "Anyone opening this link will see a warning first: {reasons}",
  "m.veryLong":
    "At {length} characters, some chat apps and older servers may truncate this link.",
  "m.copy": "Copy",
  "m.copied": "Copied",
  "m.qr": "QR",
  "m.language": "Language",
});
