/**
 * Clent — the page.
 *
 * All the interesting work lives in clent.js; this file is the two views that
 * sit on top of it. Which one runs is decided by whether the URL carries a
 * fragment, so one document serves as both the link maker and the redirector.
 */

import {
  analyze, expand, isFollowable, assess, canCompress, MODE_NAMES,
  RISK_BLOCK, ClentError, ENCODABLE,
} from "./clent.js";
import {
  checksum, sign, split, join, verify, canSign, TAG_CHECK, TAG_SIGNED,
} from "./sign.js";
import { toEmoji, toDense, decodeTransport } from "./transport.js";
import { qrMatrix } from "./qr.js";
import { choose, has, language, setLanguage, t, translate, CATALOGUES } from "./i18n.js";

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** The same lookup, for elements the code reads values or state from. */
const field = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** The same lookup, for anchors whose href the code sets. */
const anchor = (id) => /** @type {HTMLAnchorElement} */ (document.getElementById(id));

/**
 * Run once the document has a body to touch.
 *
 * The built page runs this script in <head>, before the body exists, so that
 * a redirect can fire without waiting for the rest of the document to parse.
 * Everything that needs the DOM goes through here instead.
 */
function whenReady(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

// Language before anything is written to the DOM, so nothing is painted in one
// language and replaced in another. navigator.languages is the browser's own
// ordered preference list; nothing is stored, and nothing is asked of a server.
setLanguage(choose(navigator.languages ?? [navigator.language ?? "en"]));

/** Called after a language change so views can redraw text they set by hand. */
const retranslate = [];

/**
 * The picker exists only when there is something to pick — a dropdown with one
 * entry is furniture, not a control. Each language names itself in its own
 * words, because someone looking for their language does not read the current
 * one. The choice lasts for the session: there is nowhere to store it, which
 * is the same reason nothing else here is stored either.
 *
 * It is hidden on the redirect view. That view is a security interstitial that
 * exists for a second, its language already came from the browser's own
 * preference list, and redrawing a warning under someone about to click
 * Continue is worse than not offering the control there.
 */
function buildLanguagePicker() {
  const codes = Object.keys(CATALOGUES);
  if (codes.length < 2) return;
  const select = /** @type {HTMLSelectElement} */ ($("lang"));
  for (const code of codes) {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = CATALOGUES[code]["lang.name"] ?? code;
    select.append(option);
  }
  select.value = language();
  select.addEventListener("change", () => {
    setLanguage(select.value);
    translate();
    for (const redraw of retranslate) redraw();
  });
  $("lang-pick").hidden = false;
}

/**
 * The head script has already chosen the view, so this reads its answer rather
 * than deriving it again. It is also the cheapest thing on the redirect path:
 * translating a maker nobody is looking at, and building a picker that view
 * hides anyway, is work between someone clicking a link and arriving.
 */
const redirecting = () => document.documentElement.dataset.mode === "redirect";

if (redirecting()) {
  whenRedirectView(() => translate($("redirect")));
} else {
  whenReady(() => {
    translate();
    buildLanguagePicker();
  });
}

/**
 * Run once the redirect card is in the document — which is long before the
 * document is finished.
 *
 * Everything the redirect view writes to lives inside that card, and #r-go is
 * the last of it, so its arrival is the real signal. Waiting on
 * DOMContentLoaded instead means waiting for the maker, the explainer and the
 * FAQ underneath it: most of the page, and none of it on the path between
 * clicking a link and seeing where it goes.
 */
function whenRedirectView(fn) {
  if (document.getElementById("r-go")) return fn();
  if (document.readyState !== "loading") return whenReady(fn);
  const observer = new MutationObserver(() => {
    if (!document.getElementById("r-go")) return;
    observer.disconnect();
    fn();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/** Marks a link as "show me where this goes" rather than "take me there". */
const PREVIEW_SUFFIX = "~";

/* -------------------------------------------------------------------------- *
 * Redirect view
 * -------------------------------------------------------------------------- */

/** Render the shared "this link didn't work" card. */
function showLinkFailure(message) {
  whenRedirectView(() => {
    $("r-spinner")?.remove();
    $("r-title").textContent = "This link didn't work";
    $("r-note").textContent = message;
    $("r-dest")?.remove();
    $("r-go")?.remove();
  });
}

async function runRedirect() {
  let fragment;
  try {
    // A malformed percent sequence ("#%") throws URIError here; without the
    // guard that was an unhandled rejection and a spinner that never stopped.
    fragment = decodeURIComponent(location.hash.slice(1));
  } catch {
    showLinkFailure(t("err.damagedAddress"));
    return;
  }
  let previewOnly = false;
  if (fragment.endsWith(PREVIEW_SUFFIX)) {
    previewOnly = true;
    fragment = fragment.slice(0, -1);
  }
  if (fragment.startsWith("!")) {
    previewOnly = true;
    fragment = fragment.slice(1);
  }

  const { payload: dressed, kind, tag } = split(fragment);
  let payload;
  try {
    payload = decodeTransport(dressed);
  } catch (error) {
    showLinkFailure(error instanceof ClentError ? error.message : t("err.damaged"));
    return;
  }

  // An integrity check is verified before the destination is shown, let alone
  // followed: if the payload was altered, whatever it decodes to is not what
  // was shared, and showing it would just be a confident wrong answer.
  let tagState = null;
  if (kind === TAG_CHECK) {
    const result = await verify(payload, kind, tag);
    if (result.ok === null) {
      // Cannot check ≠ altered. Show the destination with an "unverified"
      // note instead of accusing a perfectly good link, but never
      // auto-redirect past a check that could not run.
      tagState = { kind, ok: null };
      previewOnly = true;
    } else if (!result.ok) {
      whenRedirectView(() => {
        $("r-spinner").remove();
        $("r-title").textContent = t("tag.altered");
        $("r-note").textContent = result.reason ??
          "Its integrity check doesn't match, so it isn't the link that was shared. " +
          "It may have been clipped in transit, or edited.";
        $("r-dest").remove();
        $("r-go").remove();
      });
      return;
    } else {
      tagState = { kind, ok: true };
    }
  } else if (kind === TAG_SIGNED) {
    // A signature needs a passphrase, which means waiting for a human.
    tagState = { kind, ok: false, needsPassphrase: true };
    previewOnly = true;
  }

  let url;
  try {
    url = await expand(payload);
  } catch (error) {
    showLinkFailure(error instanceof ClentError ? error.message : "This link is damaged.");
    return;
  }

  const risk = assess(url);
  const follow = isFollowable(url);

  // The fast path: no DOM needed, so this can happen while the body is still
  // being parsed. Everything below is the slow path, where we have something
  // to show and can afford to wait for elements to exist.
  if (follow && !previewOnly && risk.level < RISK_BLOCK) {
    location.replace(url.href);
    return;
  }

  whenRedirectView(() => {
    $("r-spinner").remove();
    // textContent, never innerHTML: this string is attacker-controlled.
    $("r-dest").textContent = url.href;
    // The allowlist is enforced in finish() when the URL is built, but the
    // scheme table is append-only and expected to grow, and this is the one
    // place a decoded string becomes something a click can navigate to.
    // Re-asserting it here keeps the invariant next to its sink rather than
    // in another module.
    if (ENCODABLE.has(url.protocol)) anchor("r-go").href = url.href;

    if (tagState?.kind === TAG_CHECK) {
      const note = document.createElement("p");
      note.className = tagState.ok ? "tag-note ok" : "tag-note";
      note.textContent = tagState.ok
        ? t("tag.ok")
        : "This browser can't check the link's integrity tag, so it is unverified.";
      $("r-dest").after(note);
    }

    if (tagState?.needsPassphrase) {
      const box = $("r-passphrase");
      box.hidden = false;
      const check = async () => {
        const result = await verify(payload, TAG_SIGNED, tag, field("r-pass").value);
        const existing = box.querySelector(".tag-note");
        if (existing) existing.remove();
        const note = document.createElement("p");
        note.className = `tag-note ${result.ok ? "ok" : "bad"}`;
        note.textContent = result.ok
          ? t("sig.ok")
          : t("sig.bad");
        box.append(note);
      };
      $("r-check").addEventListener("click", check);
      $("r-pass").addEventListener("keydown", (event) => {
        if (event.key === "Enter") check();
      });
    }

    if (risk.reasons.length) {
      const list = $("r-warnings");
      list.hidden = false;
      list.replaceChildren(...risk.reasons.map((reason) => {
        const item = document.createElement("li");
        item.className = reason.level >= RISK_BLOCK ? "warn" : "note";
        // The reason's own English is the fallback: a code with no catalogue
        // entry must still say why the page stopped, not print its own key.
        item.textContent = has(`risk.${reason.code}`)
          ? t(`risk.${reason.code}`, reason.values)
          : reason.message;
        return item;
      }));
    }

    if (risk.level >= RISK_BLOCK) {
      $("r-title").textContent = t("r.check");
      $("r-note").textContent = t("r.worthLook");
    } else if (!follow) {
      $("r-title").textContent = t("r.openExternal");
      $("r-note").textContent =
        t("r.externalApp", { scheme: url.protocol.replace(":", "") });
    } else if (tagState?.needsPassphrase) {
      $("r-title").textContent = t("r.signed");
      $("r-note").textContent =
        t("r.signedNote");
    } else {
      $("r-title").textContent = t("r.where");
      $("r-note").textContent =
        t("r.nothingLoaded");
    }
  });
}

/* -------------------------------------------------------------------------- *
 * Create view
 * -------------------------------------------------------------------------- */

/**
 * The page's own address, without any fragment, as the link prefix. The last
 * path segment is dropped whatever it is, not just "index.html": on GitHub
 * Pages a mistyped path serves this same app as 404.html, and links made
 * from that page must not embed the typo.
 */
const origin = () => location.origin + location.pathname.replace(/[^/]*$/, "");

const bits = (n) => `${n} bit${n === 1 ? "" : "s"}`;

/** Render the "where every bit went" panel from an Analysis. */
function renderBreakdown(result) {
  const total = result.headerBits + result.hostFieldBits + result.bodyBits;
  const hostBits = result.hostByte === null ? result.hostFieldBits : 8;
  const headerBits = result.headerBits - (result.hostByte === null ? 0 : 8);

  const hostNote = result.template !== null
    ? "part of the recognised pattern"
    : result.hostByte !== null
      ? `${result.host}, dictionary entry ${result.hostByte}`
      : result.hostFieldBits
        ? `${result.host}, in its own code — the suffix is one symbol`
        : "spelled inside the body text";

  const segments = [
    {
      css: "b-header",
      colour: "var(--seg-header)",
      bits: headerBits,
      name: "Header",
      note: "scheme, www, dictionary flag, body mode",
      cost: bits(headerBits),
    },
    {
      css: "b-host",
      colour: "var(--seg-host)",
      bits: hostBits,
      name: "Host",
      note: hostNote,
      cost: hostBits ? bits(hostBits) : "—",
    },
    {
      css: "b-body",
      colour: "var(--seg-body)",
      bits: result.bodyBits,
      name: "Body",
      note: result.template !== null
        ? `the IDs from ${result.templatePattern}`
        : `path, query and fragment, as ${result.modeName === "host" ? "text" : result.modeName}`,
      cost: bits(result.bodyBits),
    },
  ];

  $("bits").replaceChildren(...segments
    .filter((segment) => segment.bits > 0)
    .map((segment) => {
      const el = document.createElement("i");
      el.className = segment.css;
      el.style.width = `${(100 * segment.bits) / total}%`;
      el.title = `${segment.name}: ${segment.cost}`;
      return el;
    }));

  $("legend").replaceChildren(...segments.map((segment) => {
    const li = document.createElement("li");

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = segment.bits ? segment.colour : "var(--line)";

    const label = document.createElement("span");
    label.append(segment.name);
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = ` — ${segment.note}`;
    label.append(note);

    const cost = document.createElement("span");
    cost.className = "cost";
    cost.textContent = segment.cost;

    li.append(swatch, label, cost);
    return li;
  }));

  // Candidate comparison. The longest bar is the worst option, so scale to it.
  const lengths = Object.values(result.candidates).filter((n) => n !== null);
  const worst = Math.max(...lengths);

  $("modes").replaceChildren(...MODE_NAMES.map((name) => {
    const length = result.candidates[name];
    const row = document.createElement("div");
    row.className = "mode-row";
    if (length === null) row.classList.add("unavailable");
    else if (length === result.payload.length) row.classList.add("won");

    const label = document.createElement("span");
    label.className = "name";
    label.textContent = name;

    const track = document.createElement("span");
    track.className = "track";
    const fill = document.createElement("i");
    fill.style.width = length === null ? "0%" : `${(100 * length) / worst}%`;
    track.append(fill);

    const value = document.createElement("span");
    value.className = "len";
    value.textContent = length === null ? "unavailable" : `${length} chars`;

    row.append(label, track, value);
    return row;
  }));
}

/** @param {string} [prefill] URL handed over by the bookmarklet fragment */
function setUpCreate(prefill = "") {
  if (typeof prefill !== "string") prefill = "";
  const input = field("url");
  const error = $("error");
  const result = $("result");
  const breakdown = $("breakdown");

  if (!canSign) {
    field("tamper").checked = false;
    field("tamper").disabled = true;
  }

  // The bookmarklet can only be written at runtime: its target is wherever
  // this page is actually served from, which a static file cannot know.
  const mark = anchor("bookmarklet");
  mark.href = "javascript:location.href=" +
    JSON.stringify(origin() + "#s=") + "+encodeURIComponent(location.href)";

  if (!canCompress) {
    $("clean-note").textContent =
      "utm_*, fbclid, gclid · this browser can't DEFLATE, so links will be longer";
  }

  const clear = () => {
    result.hidden = true;
    breakdown.hidden = true;
    error.hidden = true;
  };

  async function update() {
    if (!input.value.trim()) {
      clear();
      return;
    }

    let analysis;
    try {
      analysis = await analyze(input.value, { stripTracking: field("clean").checked });
    } catch (failure) {
      error.textContent = failure instanceof ClentError
        ? failure.message
        : t("err.notEncoded");
      error.hidden = false;
      result.hidden = true;
      breakdown.hidden = true;
      return;
    }

    error.hidden = true;

    // Tags are computed over the payload, so they never change where the link
    // goes — stripping one leaves a working link, it just stops being checkable.
    const style = field("style").value;
    let fragment = style === "emoji" ? toEmoji(analysis.payload)
      : style === "dense" ? toDense(analysis.payload)
      : analysis.payload;
    const passphrase = field("passphrase").value.trim();
    try {
      if (passphrase) {
        fragment = join(fragment, TAG_SIGNED, await sign(analysis.payload, passphrase));
      } else if (field("tamper").checked && canSign) {
        // Computed over the canonical payload, so the tag is the same
        // whichever dress the link wears.
        fragment = join(fragment, TAG_CHECK, await checksum(analysis.payload));
      }
    } catch {
      // Hashing unavailable: a plain link is still a working link.
    }

    const link = origin() + "#" + fragment +
      (field("preview").checked ? PREVIEW_SUFFIX : "");
    field("short").value = link;
    result.hidden = false;
    breakdown.hidden = false;
    renderQr();

    const before = input.value.trim().length;
    const after = link.length;
    const widest = Math.max(before, after);
    $("bar-long").style.width = `${(100 * before) / widest}%`;
    $("bar-short").style.width = `${(100 * after) / widest}%`;
    $("len-long").textContent = String(before);
    $("len-short").textContent = String(after);

    const verdict = $("verdict");
    const saved = before - after;
    if (saved > 0) {
      verdict.textContent = `${saved} characters shorter` +
        (analysis.removed.length
          ? `, after removing ${analysis.removed.length} tracking parameter` +
            `${analysis.removed.length === 1 ? "" : "s"}`
          : "");
      verdict.className = "verdict win";
    } else if (saved === 0) {
      verdict.textContent = "Exactly the same length.";
      verdict.className = "verdict";
    } else {
      verdict.textContent =
        `${-saved} characters longer. This URL is already short enough that ` +
        "carrying it whole costs more than it saves.";
      verdict.className = "verdict lose";
    }

    // Honesty notes: a link that will always hit the warning interstitial,
    // or one long enough that some apps and servers truncate it, should say
    // so here, at creation time — not surprise the recipient.
    const notes = [];
    const risk = assess(analysis.url);
    if (risk.reasons.length) {
      notes.push("Anyone opening this link will see a warning first: " +
        risk.reasons.map((reason) => reason.message).join(" "));
    }
    if (link.length > 2000) {
      notes.push(`At ${link.length} characters, some chat apps and older ` +
        "servers may truncate this link.");
    }
    document.querySelectorAll(".maker-note").forEach((el) => el.remove());
    for (const text of notes) {
      const note = document.createElement("p");
      note.className = "maker-note";
      note.textContent = text;
      verdict.after(note);
    }

    renderBreakdown(analysis);
  }

  // A rejection out of an async listener is otherwise unhandled: the page
  // would look fine and just silently stop updating.
  const safeUpdate = () => update().catch(() => {
    error.textContent = "Something went wrong — try editing the URL.";
    error.hidden = false;
  });

  // Debounced so that typing stays responsive; DEFLATE runs on every keystroke.
  let pending;
  const schedule = () => {
    clearTimeout(pending);
    pending = setTimeout(safeUpdate, 120);
  };

  input.addEventListener("input", schedule);
  input.addEventListener("paste", () => setTimeout(safeUpdate, 0));
  // The note under the style picker is the one piece of maker copy that is
  // swapped rather than translated in place, so it carries its key instead of
  // its text — and re-reads it whenever the language changes.
  const STYLE_NOTE_KEYS = {
    plain: "m.styleNotePlain",
    dense: "m.styleNoteDense",
    emoji: "m.styleNoteEmoji",
  };
  retranslate.push(() => showStyleNote());
  const showStyleNote = () => {
    $("style-note").textContent = t(STYLE_NOTE_KEYS[field("style").value]);
  };
  for (const id of ["clean", "preview", "tamper", "style"]) {
    $(id).addEventListener("change", () => {
      showStyleNote();
      safeUpdate();
    });
  }
  $("passphrase").addEventListener("input", schedule);

  $("copy").addEventListener("click", async () => {
    const button = $("copy");
    const link = field("short");
    try {
      await navigator.clipboard.writeText(link.value);
    } catch {
      link.select();
      document.execCommand("copy");
    }
    button.textContent = t("m.copied");
    setTimeout(() => { button.textContent = t("m.copy"); }, 1400);
  });

  // The QR is the same link for another device's camera; it renders from
  // the finished link string, so it can never disagree with the text field.
  const qrBox = $("qr-box");
  const qrButton = $("qr");
  const renderQr = () => {
    qrBox.querySelector("svg")?.remove();
    if (qrBox.hidden) return;
    const link = field("short").value;
    const code = link && qrMatrix(link);
    if (!code) { qrBox.hidden = true; qrButton.setAttribute("aria-pressed", "false"); return; }
    const { size, modules } = code;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "QR code for the short link");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    path.setAttribute("d", d);
    path.setAttribute("fill", "#000");
    svg.append(path);
    qrBox.prepend(svg);
  };
  qrButton.addEventListener("click", () => {
    qrBox.hidden = !qrBox.hidden;
    qrButton.setAttribute("aria-pressed", String(!qrBox.hidden));
    renderQr();
  });

  if (prefill) {
    input.value = prefill;
    safeUpdate();
  }
  input.focus();
}

/* -------------------------------------------------------------------------- *
 * Entry
 * -------------------------------------------------------------------------- */

if (self !== top) {
  // Framed. The head script already swapped the page for the refusal notice
  // before paint; this stops the decode, the auto-redirect and every href
  // assignment below from happening at all, so there is nothing behind the
  // notice for an overlay to aim a click at.
  whenReady(() => {
    anchor("framed-out").href = origin() + location.hash;
  });
} else if (location.hash.startsWith("#s=")) {
  // The bookmarklet's fragment: open the maker prefilled. The URL rides the
  // fragment for the same reason payloads do — it never reaches a server.
  let prefill = "";
  try {
    prefill = decodeURIComponent(location.hash.slice(3));
  } catch { /* a mangled prefill just opens the maker empty */ }
  // Cleared immediately so a reload or a copied address doesn't re-carry it.
  history.replaceState(null, "", location.pathname + location.search);
  whenReady(() => setUpCreate(prefill));
} else if (location.hash.length > 1) {
  // Every expected failure inside runRedirect renders its own card; this
  // catch is for the unexpected ones, which otherwise leave the spinner
  // running forever with the error only in the console.
  runRedirect().catch(() => showLinkFailure(t("err.wrong")));
} else {
  whenReady(() => setUpCreate());
}

// Pasting a Clent link into an already-open tab only changes the fragment,
// which is not a navigation, so nothing would happen without this.
addEventListener("hashchange", () => location.reload());

// After one visit the page works with no connection: links decode locally,
// so the network was only ever needed to fetch this document. Failure is
// fine — the page just stays online-only.
/**
 * Registering fetches sw.js and runs an install, which on the redirect path
 * competes with the one thing that matters. Nothing here is needed for this
 * visit — the worker is for the *next* one — so it waits until the browser
 * has nothing better to do. The timeout is the floor: an idle callback that
 * never comes must not mean a page that never caches itself.
 */
const whenIdle = (fn) =>
  ("requestIdleCallback" in globalThis
    ? requestIdleCallback(fn, { timeout: 3000 })
    : addEventListener("load", () => setTimeout(fn, 200), { once: true }));

if ("serviceWorker" in navigator) whenIdle(() => {
  // register() takes a TrustedScriptURL under require-trusted-types-for, so
  // the one script URL this page ever mints goes through a named policy that
  // accepts exactly one literal and nothing else. The CSP allows that policy
  // by name, so anything else trying to create a script URL still fails.
  let target = "./sw.js";
  try {
    const policy = globalThis.trustedTypes?.createPolicy("clent-sw", {
      createScriptURL: (url) => {
        if (url !== "./sw.js") throw new TypeError(`refusing to mint ${url}`);
        return url;
      },
    });
    if (policy) target = policy.createScriptURL("./sw.js");
  } catch { /* no Trusted Types here, or the policy already exists */ }
  navigator.serviceWorker.register(target).catch(() => {});
});
