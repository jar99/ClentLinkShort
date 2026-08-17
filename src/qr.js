/**
 * A QR encoder, because a link you can't hand to a phone is only half
 * shareable — and pulling in a library for it would be the page's first
 * dependency.
 *
 * Deliberately narrow: byte mode only, error correction level M, versions
 * 1..11 (up to 251 bytes — far past any link this page produces). Encoding
 * follows ISO/IEC 18004: Reed–Solomon over GF(256), all eight masks scored
 * by the standard penalties, format and version info BCH-coded. The test
 * suite compares whole matrices against a reference implementation.
 *
 * @module qr
 */

/* -------------------------------------------------------------------------- *
 * Tables (error correction level M)
 * -------------------------------------------------------------------------- */

/**
 * Per version 1..11: error-correction codewords per block, then the block
 * list as [count, dataCodewords] pairs. From the spec's table 9.
 * @type {ReadonlyArray<[number, Array<[number, number]>]>}
 */
const BLOCKS = [
  [10, [[1, 16]]],
  [16, [[1, 28]]],
  [26, [[1, 44]]],
  [18, [[2, 32]]],
  [24, [[2, 43]]],
  [16, [[4, 27]]],
  [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]],
  [22, [[3, 36], [2, 37]]],
  [26, [[4, 43], [1, 44]]],
  [30, [[1, 50], [4, 51]]],
];

/** Alignment pattern centre coordinates per version 1..11. */
const ALIGNMENT = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
];

/* -------------------------------------------------------------------------- *
 * GF(256) and Reed–Solomon
 * -------------------------------------------------------------------------- */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** Generator polynomial of the given degree, cached. */
const generators = new Map();
function generator(degree) {
  let poly = generators.get(degree);
  if (poly) return poly;
  poly = new Uint8Array([1]);
  for (let d = 0; d < degree; d++) {
    const next = new Uint8Array(poly.length + 1);
    for (let i = 0; i < poly.length; i++) {
      next[i] ^= mul(poly[i], EXP[d]);
      next[i + 1] ^= poly[i];
    }
    poly = next;
  }
  generators.set(degree, poly);
  return poly;
}

/**
 * Reed–Solomon error-correction codewords for a data block. The generator
 * array is lowest-degree-first (that is how the construction above builds
 * it), so the synthetic division indexes it from the top down.
 */
function ecFor(data, degree) {
  const gen = generator(degree);
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    if (factor) {
      for (let i = 0; i < degree; i++) {
        remainder[i] ^= mul(gen[degree - 1 - i], factor);
      }
    }
  }
  return remainder;
}

/* -------------------------------------------------------------------------- *
 * Codeword assembly
 * -------------------------------------------------------------------------- */

/** Data codeword count for a version (1-indexed). */
function dataCodewords(version) {
  const [, blocks] = BLOCKS[version - 1];
  return blocks.reduce((sum, [count, data]) => sum + count * data, 0);
}

/** Byte-mode capacity: the 4-bit mode + 8/16-bit count header comes off. */
export function qrCapacity(version) {
  return dataCodewords(version) - (version >= 10 ? 3 : 2);
}

/** Interleaved data + EC codewords for the payload bytes. */
function codewordsFor(bytes, version) {
  const [ecPerBlock, blockSpec] = BLOCKS[version - 1];
  const total = dataCodewords(version);

  // Bit stream: mode, count, bytes, terminator, byte padding.
  const stream = new Uint8Array(total);
  let bit = 0;
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) {
      if ((value >> i) & 1) stream[bit >> 3] |= 0x80 >> (bit & 7);
      bit++;
    }
  };
  push(0b0100, 4);
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const byte of bytes) push(byte, 8);
  // Terminator (up to 4 zero bits) and align: zeros are already there.
  bit = Math.min(bit + 4, total * 8);
  bit = (bit + 7) & ~7;
  // Pad codewords alternate 0xEC / 0x11.
  for (let i = bit >> 3, flip = false; i < total; i++, flip = !flip) {
    stream[i] = flip ? 0x11 : 0xec;
  }

  // Split into blocks, compute EC, interleave.
  const dataBlocks = [];
  const ecBlocks = [];
  let at = 0;
  for (const [count, size] of blockSpec) {
    for (let i = 0; i < count; i++) {
      const block = stream.subarray(at, at + size);
      dataBlocks.push(block);
      ecBlocks.push(ecFor(block, ecPerBlock));
      at += size;
    }
  }

  const out = new Uint8Array(total + ecPerBlock * dataBlocks.length);
  let o = 0;
  const longest = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < longest; i++) {
    for (const block of dataBlocks) if (i < block.length) out[o++] = block[i];
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) out[o++] = block[i];
  }
  return out;
}

/* -------------------------------------------------------------------------- *
 * Matrix construction
 * -------------------------------------------------------------------------- */

/** 15-bit format info (EC level M + mask), BCH-coded and masked. */
function formatBits(mask) {
  // Level M is 0b00 in the format field.
  let value = mask;
  let bch = value << 10;
  for (let i = 4; i >= 0; i--) {
    if (bch & (1 << (i + 10))) bch ^= 0b10100110111 << i;
  }
  return ((value << 10) | bch) ^ 0b101010000010010;
}

/** 18-bit version info (versions 7+), Golay-coded. */
function versionBits(version) {
  let bch = version << 12;
  for (let i = 5; i >= 0; i--) {
    if (bch & (1 << (i + 12))) bch ^= 0b1111100100101 << i;
  }
  return (version << 12) | bch;
}

/**
 * Build the QR matrix for a string.
 *
 * @param {string} text
 * @returns {{size: number, modules: Uint8Array}|null} row-major 0/1 modules,
 *   or null when the text does not fit version 11 (251 bytes)
 */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  let version = 0;
  for (let v = 1; v <= 11; v++) {
    if (bytes.length <= qrCapacity(v)) {
      version = v;
      break;
    }
  }
  if (!version) return null;

  const size = 17 + 4 * version;
  const modules = new Uint8Array(size * size);
  /** 1 where the module is a function pattern and never masked. */
  const reserved = new Uint8Array(size * size);
  const set = (x, y, dark) => {
    modules[y * size + x] = dark ? 1 : 0;
    reserved[y * size + x] = 1;
  };

  // Finder patterns with separators, in three corners.
  for (const [cx, cy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const px = cx + x;
        const py = cy + y;
        if (px < 0 || py < 0 || px >= size || py >= size) continue;
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        set(px, py, ring !== 2 && ring !== 4);
      }
    }
  }

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6 * size + i]) set(i, 6, i % 2 === 0);
    if (!reserved[i * size + 6]) set(6, i, i % 2 === 0);
  }

  // Alignment patterns. Exactly the three finder-corner positions are
  // skipped — nothing else. Patterns at (6, y) and (x, 6) exist from
  // version 7 up and deliberately sit on the timing lines (the two agree
  // on every shared module), so "skip if the centre is taken" would
  // silently drop them and shift every data bit after.
  const centres = ALIGNMENT[version - 1];
  const last = size - 7;
  for (const cy of centres) {
    for (const cx of centres) {
      if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) ||
          (cx === last && cy === 6)) continue;
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          set(cx + x, cy + y, Math.max(Math.abs(x), Math.abs(y)) !== 1);
        }
      }
    }
  }

  // Reserve the format info areas (written per mask below) and the dark
  // module: row 8 spans columns 0-8 and size-8..size-1, column 8 spans rows
  // 0-8 and size-7..size-1 — one module more on either side is a data
  // module, and stealing it shifts every data bit after it.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
    if (i < 8) set(size - 1 - i, 8, false);
    if (i < 7) set(8, size - 1 - i, false);
  }
  set(8, size - 8, true); // the one always-dark module

  // Version info blocks for versions 7+.
  if (version >= 7) {
    const info = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = (info >> i) & 1;
      set(Math.floor(i / 3), size - 11 + (i % 3), dark);
      set(size - 11 + (i % 3), Math.floor(i / 3), dark);
    }
  }

  // Data placement: two-module columns snaking up and down, skipping the
  // vertical timing column.
  const codewords = codewordsFor(bytes, version);
  let bitIndex = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (const x of [right, right - 1]) {
        if (reserved[y * size + x]) continue;
        let dark = 0;
        if (bitIndex < totalBits) {
          dark = (codewords[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
          bitIndex++;
        }
        modules[y * size + x] = dark;
      }
    }
    upward = !upward;
  }

  // Try every mask; keep the lowest penalty.
  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = Uint8Array.from(modules);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y * size + x] && MASKS[mask](x, y)) {
          candidate[y * size + x] ^= 1;
        }
      }
    }
    drawFormat(candidate, size, formatBits(mask));
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { candidate, score };
  }

  return { size, modules: best.candidate };
}

/** Write the 15 format bits into both of their homes. */
function drawFormat(modules, size, bits) {
  for (let i = 0; i < 15; i++) {
    const dark = (bits >> i) & 1;
    // Around the top-left finder.
    if (i < 6) modules[i * size + 8] = dark;
    else if (i === 6) modules[7 * size + 8] = dark;
    else if (i === 7) modules[8 * size + 8] = dark;
    else if (i === 8) modules[8 * size + 7] = dark;
    else modules[8 * size + (14 - i)] = dark;
    // Split between the other two finders.
    if (i < 8) modules[8 * size + (size - 1 - i)] = dark;
    else modules[(size - 15 + i) * size + 8] = dark;
  }
}

/** The spec's four penalty rules; lower is better. */
function penalty(modules, size) {
  const at = (x, y) => modules[y * size + x];
  let score = 0;

  // Rule 1: runs of 5+ same-coloured modules, both directions.
  for (let axis = 0; axis < 2; axis++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      let last = axis ? at(a, 0) : at(0, a);
      for (let b = 1; b < size; b++) {
        const value = axis ? at(a, b) : at(b, a);
        if (value === last) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          last = value;
          run = 1;
        }
      }
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const v = at(x, y);
      if (v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 pattern with 4 light modules beside it.
  const PATTERNS = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  for (let axis = 0; axis < 2; axis++) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b <= size - 11; b++) {
        for (const pattern of PATTERNS) {
          let hit = true;
          for (let i = 0; i < 11; i++) {
            const value = axis ? at(a, b + i) : at(b + i, a);
            if (value !== pattern[i]) {
              hit = false;
              break;
            }
          }
          if (hit) {
            score += 40;
            break;
          }
        }
      }
    }
  }

  // Rule 4: dark-module proportion, 10 points per 5% step from 50%.
  let dark = 0;
  for (const module of modules) dark += module;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}
