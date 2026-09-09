import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function inRoundRect(x, y, l, t, w, h, r) {
  if (x < l || y < t || x >= l + w || y >= t + h) return false;
  const dx = x < l + r ? l + r - x : x >= l + w - r ? x - (l + w - r) : 0;
  const dy = y < t + r ? t + r - y : y >= t + h - r ? y - (t + h - r) : 0;
  if (dx === 0 || dy === 0) return true;
  return dx * dx + dy * dy <= r * r;
}

function onStroke(x, y, l, t, w, h, r, sw) {
  return inRoundRect(x, y, l, t, w, h, r) && !inRoundRect(x, y, l + sw, t + sw, w - sw * 2, h - sw * 2, Math.max(0, r - sw));
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * The mark is a viewfinder: a rounded-square outline interrupted on both
 * diagonals, plus a solid focus point. Authored in a 48 unit box and placed in
 * the 64 unit plate at 0.85 scale, matching web/public/icon.svg.
 */
function iconPixel(size, x, y) {
  const s = size / 64;
  if (!inRoundRect(x, y, 0, 0, size, size, 14 * s)) return [0, 0, 0, 0];

  const cx = 32 * s;
  const cy = 32 * s;
  if (inCircle(x, y, cx, cy, 3.57 * s)) return [250, 250, 250, 255];

  // Outline of the rounded square, stroke centred on the 18.4..45.6 path.
  const sw = 2.89 * s;
  const l = 16.955 * s;
  const w = 30.09 * s;
  const r = 10.795 * s;
  if (onStroke(x, y, l, l, w, w, r, sw)) {
    // Cut the stroke where it crosses either diagonal, leaving two brackets.
    const u = x - cx;
    const v = y - cy;
    const len = Math.hypot(u, v);
    if (len === 0) return [10, 10, 10, 255];
    const alongDiagonal = Math.abs(u - v) / (Math.SQRT2 * len);
    if (alongDiagonal <= 0.789) return [250, 250, 250, 255];
  }
  return [10, 10, 10, 255];
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "../public");
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(join(dir, name), png(size, (x, y) => iconPixel(size, x, y)));
}
