/**
 * Mine the header code: canonical-Huffman lengths for the 64 header values,
 * from how often each one actually wins over the corpus.
 *
 * Every payload starts with one header symbol, so this is the one table
 * whose savings apply to every link ever made. All 64 values get a codeword
 * — combinations the encoder never produces are smoothed to frequency 1 so
 * the decoder can still parse (and then reject) them — and the length cap
 * keeps the worst legal header readable in one readSymbol walk.
 *
 * Usage: node tools/mine-header.mjs [--force]
 * Paste the printed array over HEADER_CODE_LENGTHS in src/clent.js, then
 * regenerate the compat goldens in the same commit (beta stance).
 */
import { shorten, HEADER_CODE_LENGTHS } from "../src/clent.js";
import { BitReader } from "../src/bits.js";
import { buildCode, readSymbol } from "../src/huffman.js";
import { sampleCorpus } from "./corpus.js";
import { mineGuard } from "./mine-stamp.js";

const MAX_CODE_LEN = 12;
const SYMBOLS = 64;
// A capped whole-corpus sample rather than every line: the raw corpus
// over-holds a few registry hosts, and their header values with them.
const SAMPLE = 400000;

// This one runs the whole encoder to see which header each URL ends up with,
// so every table it consults is an input — hence all of src/, not a subset.
// Over-declaring costs an unnecessary re-mine; under-declaring would ship a
// header code fitted to a wire that has since moved.
const guard = await mineGuard("header", {
  files: [
    "tools/mine-header.mjs", "tools/corpus.js",
    "src/clent.js", "src/bits.js", "src/huffman.js", "src/text.js",
    "src/textcode.js", "src/host.js", "src/hostcode.js", "src/hosts.js",
    "src/templates.js", "src/schemes.js", "src/deflate.js", "src/tracking.js",
  ],
  params: { SAMPLE, MAX_CODE_LEN, SYMBOLS },
  force: process.argv.includes("--force"),
});
if (guard.unchanged) {
  console.log(guard.message);
  process.exit(0);
}

// Decode each payload's first symbol with the SHIPPED code, so the miner
// keeps working after its own output lands.
const shipped = buildCode(HEADER_CODE_LENGTHS);
const freq = new Array(SYMBOLS).fill(1); // +1 smoothing: every value parses
let counted = 0;
for await (const u of sampleCorpus(SAMPLE, { salt: "hdr|", hostCap: 0.01 })) {
  let p;
  try { p = await shorten(u, { stripTracking: false }); } catch { continue; }
  freq[readSymbol(new BitReader(p), shipped)]++;
  counted++;
}

// Plain Huffman over the frequencies, then clamp and re-Kraft, the same way
// mine-text.mjs does.
function huffmanLengths(frequencies) {
  const heap = frequencies.map((f, s) => ({ f, syms: [s] }));
  const lengths = new Uint8Array(SYMBOLS);
  while (heap.length > 1) {
    heap.sort((a, b) => a.f - b.f);
    const a = heap.shift(), b = heap.shift();
    for (const s of a.syms) lengths[s]++;
    for (const s of b.syms) lengths[s]++;
    heap.push({ f: a.f + b.f, syms: [...a.syms, ...b.syms] });
  }
  for (let s = 0; s < SYMBOLS; s++) {
    if (lengths[s] > MAX_CODE_LEN) lengths[s] = MAX_CODE_LEN;
  }
  const kraft = () =>
    lengths.reduce((sum, l) => sum + (l ? 2 ** -l : 0), 0);
  while (kraft() > 1) {
    let best = -1;
    for (let s = 0; s < SYMBOLS; s++) {
      if (lengths[s] && lengths[s] < MAX_CODE_LEN &&
          (best === -1 || lengths[s] < lengths[best] ||
           (lengths[s] === lengths[best] && frequencies[s] < frequencies[best]))) best = s;
    }
    lengths[best]++;
  }
  return lengths;
}

const lengths = huffmanLengths(freq);

const total = freq.reduce((s, f) => s + f, 0);
const avgNew = freq.reduce((s, f, i) => s + f * lengths[i], 0) / total;
const avgOld = freq.reduce((s, f, i) => s + f * HEADER_CODE_LENGTHS[i], 0) / total;
console.log(`// ${counted.toLocaleString()} URLs | header bits ` +
  `${avgOld.toFixed(2)} -> ${avgNew.toFixed(2)} average`);
let out = "";
for (let i = 0; i < SYMBOLS; i += 16) {
  out += "  " + [...lengths.slice(i, i + 16)].join(", ") + ",\n";
}
console.log(out.replace(/,\n$/, ",\n"));

await guard.save();
