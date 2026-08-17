/**
 * Substring dictionary for the text6 body encoding.
 *
 * A token costs 12 bits (the TOKEN symbol plus a 6-bit index) in place of the
 * 6 bits per character it replaces, so any token of 3 characters or more pays
 * for itself. On the validation corpus this removes about 12% of the bits in
 * a body.
 *
 * These were mined from the corpus rather than guessed: n-grams were counted
 * over the exact strings the codec encodes, the best-scoring one was taken,
 * the corpus was re-tokenised with it, and the count was repeated. A candidate
 * also had to appear across at least 25 different hosts, which is what keeps
 * out things like one publisher's URL scheme — those score well on a corpus
 * and are worthless on the open web.
 *
 * Mining runs over the body the encoder actually emits, so hosts already in
 * the dictionary are excluded: those never reach the body, and tokens for them
 * would be slots spent on text that is never written.
 *
 * Exactly 64 entries, and APPEND-ONLY once anything is published: an entry's
 * index is its wire encoding, so changing one repoints every link that used
 * it. This table has been re-mined twice while the project is unreleased, and
 * each time the wire format version was bumped so the change is at least
 * visible. After the first real link is shared, that stops being an option.
 *
 * Order matters for nothing but the index: the encoder picks tokens by
 * dynamic programming, not by scanning this list in order.
 *
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  ".github.io", "content", "/2026/0", "article", "archive", "source",
  "search", "/index", "/blog/", "google", ".co.uk", ".html",
  "image", ".php?", "world", ".com", "wiki", ".org",
  "edia", "comm", "tion", "news", "info", ".net",
  ".htm", ".asp", ".gov", "port", ".edu", "-to-",
  "page", ".pdf", "post", "ons", "ing", ".jp",
  "ent", "the", "ori", "ina", "ter", "ile",
  "/20", "and", "mpa", "sta", "ine", "ign",
  "pro", "man", ".de", "che", "ist", "art",
  "ers", "res", "our", "log", "ata", "all",
  "id=", "nce", "gra", "for"
]);
