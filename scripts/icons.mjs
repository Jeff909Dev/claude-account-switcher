#!/usr/bin/env node
// Draws the toolbar icon (two overlapping account avatars) as PNGs with no dependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const CLAY = [217, 119, 87];
const SLATE = [91, 122, 166]; // the third account colour
const IVORY = [250, 249, 245];
const GAP = 0.05; // transparent ring between the two avatars

const inCircle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) <= r;
/** A head-and-shoulders silhouette inside the avatar disc at (cx, cy, r). */
const inPerson = (x, y, cx, cy, r) =>
  inCircle(x, y, cx, cy - 0.22 * r, 0.3 * r) || (inCircle(x, y, cx, cy + 0.8 * r, 0.6 * r) && inCircle(x, y, cx, cy, r));

/** Colour at a point of the unit square: a clay avatar in front of a slate one ("several accounts"). */
function colourAt(x, y) {
  const front = [0.37, 0.61, 0.34];
  const back = [0.65, 0.37, 0.31];
  if (inCircle(x, y, ...front)) return inPerson(x, y, ...front) ? IVORY : CLAY;
  if (inCircle(x, y, front[0], front[1], front[2] + GAP)) return null;
  return inCircle(x, y, ...back) ? SLATE : null;
}

/** Supersamples each pixel so small sizes stay smooth. */
function pixel(x, y, size) {
  const n = 8;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const c = colourAt((x - 0.5 + (i + 0.5) / n) / size, (y - 0.5 + (j + 0.5) / n) / size);
      if (!c) continue;
      r += c[0]; g += c[1]; b += c[2]; a++;
    }
  }
  return a === 0 ? [0, 0, 0, 0] : [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((255 * a) / (n * n))];
}
mkdirSync("src/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`src/icons/icon-${size}.png`, png(size, pixel));
