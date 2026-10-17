// Minimal QR code encoder for the --lan link (byte mode, error correction level M, versions 1-10).
//
// WHY a hand-written encoder: studio.mjs must be one dependency-free file that runs with plain Node.
// The only QR we ever draw is a short URL (about 50-80 bytes), so versions 1-10 at level M (up to
// 213 bytes) are plenty, and the whole encoder fits in this file. Level M survives a slightly
// blurry phone camera pointed at a terminal better than L, and keeps the code small.
//
// The algorithm follows ISO/IEC 18004: build the bit stream, split into blocks, add Reed-Solomon
// error correction, interleave, place modules in the zig-zag order, try the 8 masks and keep the
// one with the lowest penalty, then write format (and for v7+ version) information.

// Error correction table for level M: [ec codewords per block, blocks in group 1, data codewords per
// group-1 block, blocks in group 2, data codewords per group-2 block]. Index = version.
const EC_M = [
  null,
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const FORMAT_BITS_M = 0; // L=1, M=0, Q=3, H=2 (the 2-bit code used in the format information)

/**
 * Encode text as a QR matrix.
 * @param {string} text
 * @returns {boolean[][]} rows of modules, true = dark. No quiet zone.
 */
export function encodeQR(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    const [, b1, d1, b2, d2] = EC_M[v];
    const capacityBits = (b1 * d1 + b2 * d2) * 8;
    const needBits = 4 + (v < 10 ? 8 : 16) + bytes.length * 8;
    if (needBits <= capacityBits) {
      version = v;
      break;
    }
  }
  if (!version) throw new Error('text too long for a QR code (max about 200 bytes)');

  const codewords = addErrorCorrection(dataCodewords(bytes, version), version);
  const size = version * 4 + 17;
  const modules = grid(size, false);
  const isFunction = grid(size, false);
  drawFunctionPatterns(modules, isFunction, version);
  placeData(modules, isFunction, codewords);

  let best = null;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = modules.map((row) => row.slice());
    applyMask(m, isFunction, mask);
    drawFormat(m, isFunction, mask);
    const p = penalty(m);
    if (p < bestPenalty) {
      bestPenalty = p;
      best = m;
    }
  }
  return best;
}

/**
 * Render a matrix for a terminal with half-block characters (two module rows per text line).
 * Uses explicit ANSI black/white so it scans on both dark and light terminal themes; phone
 * cameras often fail on inverted codes.
 */
export function qrToTerminal(matrix, quiet = 2) {
  const size = matrix.length + quiet * 2;
  const at = (y, x) => {
    const yy = y - quiet;
    const xx = x - quiet;
    return yy >= 0 && xx >= 0 && yy < matrix.length && xx < matrix.length && matrix[yy][xx];
  };
  const lines = [];
  for (let y = 0; y < size; y += 2) {
    let line = '';
    for (let x = 0; x < size; x++) {
      const top = at(y, x);
      const bottom = y + 1 < size ? at(y + 1, x) : false;
      line += `\x1b[${top ? 30 : 97};${bottom ? 40 : 107}m▀`;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}

/** Render a matrix as a small SVG (for a page that wants to show the code). */
export function qrToSvg(matrix, quiet = 4) {
  const size = matrix.length + quiet * 2;
  let d = '';
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ---------------------------------------------------------------------------------------------

function dataCodewords(bytes, version) {
  const [, b1, d1, b2, d2] = EC_M[version];
  const capacity = (b1 * d1 + b2 * d2) * 8;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

function addErrorCorrection(data, version) {
  const [ecLen, b1, d1, b2, d2] = EC_M[version];
  const divisor = rsDivisor(ecLen);
  const blocks = [];
  let k = 0;
  for (let i = 0; i < b1 + b2; i++) {
    const len = i < b1 ? d1 : d2;
    const dat = data.slice(k, k + len);
    k += len;
    blocks.push({ dat, ec: rsRemainder(dat, divisor) });
  }
  const out = [];
  const maxData = Math.max(d1, d2);
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dat.length) out.push(b.dat[i]);
  for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
  return out;
}

function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)));
  }
  return result;
}

function grid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value));
}

// Matrices are indexed [y][x] (row, column).
function drawFunctionPatterns(m, f, version) {
  const size = m.length;
  const set = (x, y, dark) => {
    m[y][x] = dark;
    f[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0); // timing patterns
    set(i, 6, i % 2 === 0);
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = ALIGN[version];
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      // Skip the three corners occupied by finder patterns.
      if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  drawFormat(m, f, 0); // reserve the format areas (real bits are written per mask later)
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
}

function drawFormat(m, f, mask) {
  const size = m.length;
  const data = (FORMAT_BITS_M << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  const set = (x, y, dark) => {
    m[y][x] = dark;
    f[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // the "dark module"
}

function placeData(m, f, codewords) {
  const size = m.length;
  let i = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!f[y][x] && i < total) {
          m[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
  }
}

function applyMask(m, f, mask) {
  const size = m.length;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (f[y][x]) continue;
      let invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      }
      if (invert) m[y][x] = !m[y][x];
    }
}

// Penalty rules 1 (runs), 2 (2x2 blocks), 3 (finder-like patterns) and 4 (dark balance). Any mask
// decodes; the penalty only picks the one that scans most reliably.
function penalty(m) {
  const size = m.length;
  let score = 0;
  const line = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      for (let b = 0; b + 10 < size; b++) {
        const s = [];
        for (let k = 0; k < 11; k++) s.push(get(a, b + k) ? 1 : 0);
        const t = s.join('');
        if (t === '10111010000' || t === '00001011101') score += 40;
      }
    }
  };
  line((y, x) => m[y][x]);
  line((x, y) => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (y + 1 < size && x + 1 < size) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}
