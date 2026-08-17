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
 * APPEND-ONLY, and exactly 64 entries. An entry's index is its wire encoding,
 * so changing one silently repoints every link that used it.
 *
 * Order matters for nothing but the index: the encoder picks tokens by
 * dynamic programming, not by scanning this list in order.
 *
 * @type {readonly string[]}
 */
export const TOKENS = Object.freeze([
  ".wikipedia", ".substack", "article", "/2026/0", ".co.uk/", "archive",
  "science", "github", "search", "/index", "/blog/", "google", ".org/",
  ".php?", "media", "world", ".edu/", ".com", ".htm", "news", "tion",
  ".net", "wiki", ".org", ".asp", "stor", "atch", ".gov", "port", "tech",
  "view", "-ai-", "-to-", "book", ".co.", "html", "ing", "ent", "the",
  "/20", "ter", "and", "id=", "ine", "log", "es/", "ist", "ers", "for",
  "all", "age", ".de", "art", "com", "pro", "con", "che", "res", "ver",
  "ang", "al-", "ata", "ser", "-in",
]);
