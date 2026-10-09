/**
 * QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1..10, which hold
 * up to 213 bytes of UTF-8 — plenty for lot numbers. Returns the module matrix; qrSvgPath() turns it
 * into an SVG path.
 */

export type QrMatrix = boolean[][];

/** Per version (index 1..10) at level M: EC codewords per block and the block groups [count, data codewords]. */
const LEVEL_M: { ec: number; groups: [number, number][] }[] = [
  { ec: 0, groups: [] },
  { ec: 10, groups: [[1, 16]] },
  { ec: 16, groups: [[1, 28]] },
  { ec: 26, groups: [[1, 44]] },
  { ec: 18, groups: [[2, 32]] },
  { ec: 24, groups: [[2, 43]] },
  { ec: 16, groups: [[4, 27]] },
  { ec: 18, groups: [[4, 31]] },
  { ec: 22, groups: [[2, 38], [2, 39]] },
  { ec: 22, groups: [[3, 36], [2, 37]] },
  { ec: 26, groups: [[4, 43], [1, 44]] },
];

const ALIGNMENT: number[][] = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

export const QR_MAX_VERSION = LEVEL_M.length - 1;
/** Format bits of level M. */
const LEVEL_M_BITS = 0;

// ---------------------------------------------------------------------------
// Reed-Solomon over GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1
// ---------------------------------------------------------------------------
const EXP = new Array<number>(512);
const LOG = new Array<number>(256);
{
  let value = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

const multiply = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Coefficients of prod(x - a^i), i < degree, highest power first without the leading 1. */
function generator(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= multiply(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly.slice(1);
}

/** Error correction codewords of one block. */
export function reedSolomon(data: readonly number[], degree: number): number[] {
  const gen = generator(degree);
  const remainder = new Array<number>(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ (remainder.shift() as number);
    remainder.push(0);
    for (let i = 0; i < degree; i++) remainder[i] ^= multiply(gen[i], factor);
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Codewords
// ---------------------------------------------------------------------------
const dataCodewords = (version: number): number =>
  LEVEL_M[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);

const countBits = (version: number): number => (version < 10 ? 8 : 16);

/** Smallest version that holds the bytes; null when even version 10 is too small. */
export function qrVersionFor(byteLength: number): number | null {
  for (let version = 1; version <= QR_MAX_VERSION; version++) {
    if (4 + countBits(version) + 8 * byteLength <= dataCodewords(version) * 8) return version;
  }
  return null;
}

function encodeData(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  bytes.forEach((byte) => push(byte, 8));
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
  return codewords;
}

/** Data split into blocks, each followed by its EC codewords, interleaved as the symbol stores them. */
function interleave(data: number[], version: number): number[] {
  const { ec, groups } = LEVEL_M[version];
  const blocks: number[][] = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(data.slice(offset, offset + size));
      offset += size;
    }
  }
  const corrections = blocks.map((block) => reedSolomon(block, ec));
  const result: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.length));
  for (let i = 0; i < longest; i++) blocks.forEach((block) => i < block.length && result.push(block[i]));
  for (let i = 0; i < ec; i++) corrections.forEach((block) => result.push(block[i]));
  return result;
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------
/** 15 format bits: level and mask with their BCH code, XOR 0x5412. */
export function formatBits(mask: number): number {
  const data = (LEVEL_M_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18 version bits (versions 7 and up): version with its BCH code. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class QrSymbol {
  readonly size: number;
  readonly modules: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.reserved = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false));
    this.drawFunctionPatterns();
  }

  private set(x: number, y: number, dark: boolean) {
    this.modules[y][x] = dark;
    this.reserved[y][x] = true;
  }

  private drawFunctionPatterns() {
    const { size } = this;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          if (x >= 0 && x < size && y >= 0 && y < size) this.set(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
    const centers = ALIGNMENT[this.version];
    const last = centers.length - 1;
    centers.forEach((cx, i) =>
      centers.forEach((cy, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }),
    );
    this.drawFormat(0);
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, dark);
        this.set(b, a, dark);
      }
    }
  }

  drawFormat(mask: number) {
    const { size } = this;
    const bits = formatBits(mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  }

  placeData(codewords: number[]) {
    const { size } = this;
    let index = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vertical = 0; vertical < size; vertical++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vertical : vertical;
          if (this.reserved[y][x]) continue;
          if (index < codewords.length * 8) {
            this.modules[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
          }
          index++;
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.reserved[y][x] && MASKS[mask](x, y)) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty(): number {
    const { size, modules } = this;
    let score = 0;
    const line = (get: (i: number) => boolean) => {
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && get(i) === get(i - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + run - 5;
          run = 1;
        }
      }
      const pattern = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= size; i++) {
        if (!pattern.every((dark, k) => get(i + k) === dark)) continue;
        const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !get(i - k));
        const lightAfter = i + 11 <= size && [7, 8, 9, 10].every((k) => !get(i + k));
        if (lightBefore || lightAfter) score += 40;
      }
    };
    for (let i = 0; i < size; i++) {
      line((x) => modules[i][x]);
      line((y) => modules[y][i]);
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (modules[y][x]) dark++;
        if (y + 1 < size && x + 1 < size) {
          const color = modules[y][x];
          if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) score += 3;
        }
      }
    }
    score += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
    return score;
  }
}

/** Module matrix (true = dark) of the text, or null when it does not fit version 10. */
export function encodeQr(text: string): QrMatrix | null {
  const bytes = new TextEncoder().encode(text);
  const version = qrVersionFor(bytes.length);
  if (version === null) return null;
  const codewords = interleave(encodeData(bytes, version), version);

  let best: QrSymbol | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const symbol = new QrSymbol(version);
    symbol.placeData(codewords);
    symbol.applyMask(mask);
    symbol.drawFormat(mask);
    const score = symbol.penalty();
    if (score < bestScore) {
      best = symbol;
      bestScore = score;
    }
  }
  return best ? best.modules : null;
}

/** SVG path of the dark modules, one rectangle per horizontal run, offset by the quiet zone. */
export function qrSvgPath(matrix: QrMatrix, quietZone: number): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (x + 1 < row.length && row[x + 1]) x++;
      parts.push(`M${start + quietZone} ${y + quietZone}h${x - start + 1}v1h-${x - start + 1}z`);
    }
  });
  return parts.join("");
}
