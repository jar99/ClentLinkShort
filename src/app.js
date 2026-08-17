/**
 * Clent — the page.
 *
 * All the interesting work lives in clent.js; this file is the two views that
 * sit on top of it. Which one runs is decided by whether the URL carries a
 * fragment, so one document serves as both the link maker and the redirector.
 */

import {
  analyze, expand, isFollowable, canCompress, MODE_NAMES, ClentError,
} from "./clent.js";

const $ = (id) => document.getElementById(id);

/** Marks a link as "show me where this goes" rather than "take me there". */
const PREVIEW_SUFFIX = "~";

/* -------------------------------------------------------------------------- *
 * Redirect view
 * -------------------------------------------------------------------------- */

async function runRedirect() {
  let fragment = decodeURIComponent(location.hash.slice(1));
  let previewOnly = false;
  if (fragment.endsWith(PREVIEW_SUFFIX)) {
    previewOnly = true;
    fragment = fragment.slice(0, -1);
  }
  if (fragment.startsWith("!")) {
    previewOnly = true;
    fragment = fragment.slice(1);
  }

  const fail = (message) => {
    $("r-spinner").remove();
    $("r-title").textContent = "This link didn't work";
    $("r-note").textContent = message;
    $("r-dest").remove();
    $("r-go").remove();
  };

  let url;
  try {
    url = await expand(fragment);
  } catch (error) {
    fail(error instanceof ClentError ? error.message : "This link is damaged.");
    return;
  }

  // textContent, never innerHTML: this string is attacker-controlled.
  $("r-dest").textContent = url.href;
  $("r-go").href = url.href;

  if (!isFollowable(url)) {
    $("r-spinner").remove();
    $("r-title").textContent = "Open this link?";
    $("r-note").textContent =
      `It opens an external app (${url.protocol.replace(":", "")}). ` +
      "Continue only if you trust it.";
    return;
  }

  if (previewOnly) {
    $("r-spinner").remove();
    $("r-title").textContent = "Where this link goes";
    $("r-note").textContent =
      "Nothing has been loaded yet. Check the destination before continuing.";
    return;
  }

  location.replace(url.href);
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
      note: `path, query and fragment, as ${result.modeName}`,
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
  const input = $("url");
  const error = $("error");
  const result = $("result");
  const breakdown = $("breakdown");

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
      analysis = await analyze(input.value, { stripTracking: $("clean").checked });
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
    const link = origin() + "#" + analysis.payload +
      ($("preview").checked ? PREVIEW_SUFFIX : "");
    $("short").value = link;
    result.hidden = false;
    breakdown.hidden = false;

    const before = input.value.trim().length;
    const after = link.length;
    const widest = Math.max(before, after);
    $("bar-long").style.width = `${(100 * before) / widest}%`;
    $("bar-short").style.width = `${(100 * after) / widest}%`;
    $("len-long").textContent = before;
    $("len-short").textContent = after;

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

  // Debounced so that typing stays responsive; DEFLATE runs on every keystroke.
  let pending;
  const schedule = () => {
    clearTimeout(pending);
    pending = setTimeout(update, 120);
  };

  input.addEventListener("input", schedule);
  input.addEventListener("paste", () => setTimeout(update, 0));
  for (const id of ["clean", "preview"]) $(id).addEventListener("change", update);

  $("copy").addEventListener("click", async () => {
    const button = $("copy");
    const link = $("short");
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
  runRedirect();
} else {
  setUpCreate();
}

// Pasting a Clent link into an already-open tab only changes the fragment,
// which is not a navigation, so nothing would happen without this.
addEventListener("hashchange", () => location.reload());
