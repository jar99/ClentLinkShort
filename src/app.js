/**
 * Clent — the page.
 *
 * All the interesting work lives in clent.js; this file is the two views that
 * sit on top of it. Which one runs is decided by whether the URL carries a
 * fragment, so one document serves as both the link maker and the redirector.
 */

import {
  analyze, expand, isFollowable, assess, canCompress, MODE_NAMES,
  RISK_BLOCK, ClentError,
} from "./clent.js";
import {
  checksum, sign, split, join, verify, canSign, TAG_CHECK, TAG_SIGNED,
} from "./sign.js";

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

/** Marks a link as "show me where this goes" rather than "take me there". */
const PREVIEW_SUFFIX = "~";

/* -------------------------------------------------------------------------- *
 * Redirect view
 * -------------------------------------------------------------------------- */

/** Render the shared "this link didn't work" card. */
function showLinkFailure(message) {
  whenReady(() => {
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
    showLinkFailure("This link is damaged — its address isn't valid.");
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

  const { payload, kind, tag } = split(fragment);

  // An integrity check is verified before the destination is shown, let alone
  // followed: if the payload was altered, whatever it decodes to is not what
  // was shared, and showing it would just be a confident wrong answer.
  let tagState = null;
  if (kind === TAG_CHECK) {
    const result = await verify(payload, kind, tag);
    if (!result.ok) {
      whenReady(() => {
        $("r-spinner").remove();
        $("r-title").textContent = "This link has been altered";
        $("r-note").textContent = result.reason ??
          "Its integrity check doesn't match, so it isn't the link that was shared. " +
          "It may have been clipped in transit, or edited.";
        $("r-dest").remove();
        $("r-go").remove();
      });
      return;
    }
    tagState = { kind, ok: true };
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

  whenReady(() => {
    $("r-spinner").remove();
    // textContent, never innerHTML: this string is attacker-controlled.
    $("r-dest").textContent = url.href;
    anchor("r-go").href = url.href;

    if (tagState?.kind === TAG_CHECK) {
      const note = document.createElement("p");
      note.className = "tag-note ok";
      note.textContent = "Integrity check passed — this link hasn't been altered.";
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
          ? "Signature verified — made by someone who knows this passphrase."
          : "Signature does not match this passphrase.";
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
        item.textContent = reason.message;
        return item;
      }));
    }

    if (risk.level >= RISK_BLOCK) {
      $("r-title").textContent = "Check this link before continuing";
      $("r-note").textContent = "It has something about it worth a second look:";
    } else if (!follow) {
      $("r-title").textContent = "Open this link?";
      $("r-note").textContent =
        `It opens an external app (${url.protocol.replace(":", "")}). ` +
        "Continue only if you trust it.";
    } else if (tagState?.needsPassphrase) {
      $("r-title").textContent = "This link is signed";
      $("r-note").textContent =
        "Nothing has been loaded yet. Check the signature, or continue without it.";
    } else {
      $("r-title").textContent = "Where this link goes";
      $("r-note").textContent =
        "Nothing has been loaded yet. Check the destination before continuing.";
    }
  });
}

/* -------------------------------------------------------------------------- *
 * Create view
 * -------------------------------------------------------------------------- */

/** The page's own address, without any fragment, as the link prefix. */
const origin = () => location.origin + location.pathname.replace(/index\.html$/, "");

const bits = (n) => `${n} bit${n === 1 ? "" : "s"}`;

/** Render the "where every bit went" panel from an Analysis. */
function renderBreakdown(result) {
  const total = result.headerBits + result.bodyBits;
  const hostBits = result.hostByte === null ? 0 : 8;
  const headerBits = result.headerBits - hostBits;

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
      note: result.hostByte === null
        ? "not in the dictionary, so it is spelled out in the body"
        : `${result.host}, dictionary entry ${result.hostByte}`,
      cost: hostBits ? bits(hostBits) : "—",
    },
    {
      css: "b-body",
      colour: "var(--seg-body)",
      bits: result.bodyBits,
      name: "Body",
      note: result.template !== null
        ? `the IDs from ${result.templatePattern}`
        : `path, query and fragment, as ${result.modeName}`,
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

function setUpCreate() {
  const input = field("url");
  const error = $("error");
  const result = $("result");
  const breakdown = $("breakdown");

  if (!canSign) {
    field("tamper").checked = false;
    field("tamper").disabled = true;
  }

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
        : "That couldn't be encoded.";
      error.hidden = false;
      result.hidden = true;
      breakdown.hidden = true;
      return;
    }

    error.hidden = true;

    // Tags are computed over the payload, so they never change where the link
    // goes — stripping one leaves a working link, it just stops being checkable.
    let fragment = analysis.payload;
    const passphrase = field("passphrase").value.trim();
    try {
      if (passphrase) {
        fragment = join(fragment, TAG_SIGNED, await sign(analysis.payload, passphrase));
      } else if (field("tamper").checked && canSign) {
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
  for (const id of ["clean", "preview", "tamper"]) $(id).addEventListener("change", safeUpdate);
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
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1400);
  });

  input.focus();
}

/* -------------------------------------------------------------------------- *
 * Entry
 * -------------------------------------------------------------------------- */

if (location.hash.length > 1) {
  // Every expected failure inside runRedirect renders its own card; this
  // catch is for the unexpected ones, which otherwise leave the spinner
  // running forever with the error only in the console.
  runRedirect().catch(() => showLinkFailure("Something went wrong opening this link."));
} else {
  whenReady(setUpCreate);
}

// Pasting a Clent link into an already-open tab only changes the fragment,
// which is not a navigation, so nothing would happen without this.
addEventListener("hashchange", () => location.reload());
