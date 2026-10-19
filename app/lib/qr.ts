/*
 * QR code encoder for the "view in your room" hand-off on desktop (the QR
 * button in ViewerPreview). Byte mode at error-correction level M, smallest
 * version that fits; follows ISO/IEC 18004 and Project Nayuki's MIT reference
 * implementation, minus the segment modes and ECC levels a URL never needs.
 *
 * Mask choice scores penalty rules 1, 2 and 4 and skips rule 3 (finder-like
 * runs). Every mask decodes; the score only picks the one that scans easiest.
 *
 * The storefront has its own copy in extensions/viewer-3d/assets/viewer-3d.js,
 * which can't import this. Keep the two in step.
 */

// Level M, indexed by version (0 unused).
const ECC_PER_BLOCK = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26,
  26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28,
];
const NUM_BLOCKS = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17,
  18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

const MASKS: Array<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function rawModules(ver: number): number {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}

function dataCodewords(ver: number): number {
  return (
    Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver]
  );
}

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result: number[] = new Array(degree).fill(0);
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

function rsRemainder(data: number[], divisor: number[]): number[] {
  const result: number[] = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= gfMul(divisor[i], factor);
    }
  }
  return result;
}

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < count; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

/**
 * The module grid (rows of booleans, true = dark), or null when the text is
 * too long for any version.
 */
export function qrEncode(text: string): boolean[][] | null {
  const bytes = Array.from(new TextEncoder().encode(text));

  let ver = 1;
  while (
    ver <= 40 &&
    4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8
  ) {
    ver++;
  }
  if (ver > 40) return null;

  // Data bits: byte-mode indicator, length, payload, then terminator, byte
  // alignment and the alternating pad bytes.
  const bits: number[] = [];
  const put = (val: number, len: number) => {
    for (let b = len - 1; b >= 0; b--) bits.push((val >>> b) & 1);
  };
  put(4, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k];
    data.push(byte);
  }

  // Split into blocks, append each block's ECC, interleave.
  const numBlocks = NUM_BLOCKS[ver];
  const eccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (rawCodewords % numBlocks);
  const shortLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let b = 0, off = 0; b < numBlocks; b++) {
    const len = shortLen - eccLen + (b < numShort ? 0 : 1);
    const dat = data.slice(off, off + len);
    off += len;
    const ecc = rsRemainder(dat, divisor);
    if (b < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const codewords: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      if (i !== shortLen - eccLen || j >= numShort) codewords.push(blocks[j][i]);
    }
  }

  const size = ver * 4 + 17;
  const grid: boolean[][] = [];
  const reserved: boolean[][] = [];
  for (let i = 0; i < size; i++) {
    grid.push(new Array(size).fill(false));
    reserved.push(new Array(size).fill(false));
  }
  const setFn = (x: number, y: number, dark: boolean) => {
    grid[y][x] = dark;
    reserved[y][x] = true;
  };

  // Function patterns: timing, finders (with separators), alignment.
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) {
          setFn(x, y, d !== 2 && d !== 4);
        }
      }
    }
  }
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) {
        continue;
      }
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  const drawFormat = (mask: number) => {
    // Level M's format indicator is 00, so the data is just the mask.
    let rem = mask;
    for (let n = 0; n < 10; n++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const f = ((mask << 10) | rem) ^ 0x5412;
    const bit = (n: number) => ((f >>> n) & 1) !== 0;
    for (let n = 0; n <= 5; n++) setFn(8, n, bit(n));
    setFn(8, 7, bit(6));
    setFn(8, 8, bit(7));
    setFn(7, 8, bit(8));
    for (let n = 9; n < 15; n++) setFn(14 - n, 8, bit(n));
    for (let n = 0; n < 8; n++) setFn(size - 1 - n, 8, bit(n));
    for (let n = 8; n < 15; n++) setFn(8, size - 15 + n, bit(n));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // reserves the format areas before data is placed

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vbits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const on = ((vbits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setFn(a, c, on);
      setFn(c, a, on);
    }
  }

  // Data, in the two-column zigzag from the bottom-right corner.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const y = upward ? size - 1 - vert : vert;
        if (!reserved[y][x] && bitIndex < codewords.length * 8) {
          grid[y][x] =
            ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (m: number) => {
    const fn = MASKS[m];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && fn(x, y)) grid[y][x] = !grid[y][x];
      }
    }
  };

  const penalty = () => {
    let score = 0;
    let dark = 0;
    for (let y = 0; y < size; y++) {
      let runX = 1;
      let runY = 1;
      for (let x = 0; x < size; x++) {
        if (grid[y][x]) dark++;
        if (x > 0) {
          // Rule 1, along rows (grid[y][x]) and columns (grid[x][y]).
          runX = grid[y][x] === grid[y][x - 1] ? runX + 1 : 1;
          if (runX === 5) score += 3;
          else if (runX > 5) score++;
          runY = grid[x][y] === grid[x - 1][y] ? runY + 1 : 1;
          if (runY === 5) score += 3;
          else if (runY > 5) score++;
        }
        // Rule 2: 2x2 blocks of one colour.
        if (
          x > 0 &&
          y > 0 &&
          grid[y][x] === grid[y][x - 1] &&
          grid[y][x] === grid[y - 1][x] &&
          grid[y][x] === grid[y - 1][x - 1]
        ) {
          score += 3;
        }
      }
    }
    // Rule 4: dark/light balance.
    const total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  };

  let best = 0;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    applyMask(m);
    drawFormat(m);
    const s = penalty();
    if (s < bestScore) {
      best = m;
      bestScore = s;
    }
    applyMask(m); // XOR again to undo
  }
  applyMask(best);
  drawFormat(best);
  return grid;
}

/**
 * The code as one SVG path in a square of `size` units, the four-module quiet
 * zone included, or null when the text is too long for any version.
 */
export function qrSvgPath(text: string): { size: number; d: string } | null {
  const grid = qrEncode(text);
  if (!grid) return null;
  let d = "";
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid.length; x++) {
      if (grid[y][x]) d += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
  }
  return { size: grid.length + 8, d };
}
