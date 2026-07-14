#!/usr/bin/env node
// Generates the extension icons (blue rounded square, white viewfinder
// brackets + center dot) as PNGs, dependency-free. Run from the repo root:
//   node tools/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];
const BG = [0x25, 0x63, 0xeb]; // #2563eb
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      raw.set([r, g, b, a], row + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function drawIcon(size) {
  const radius = size * 0.22;
  const margin = Math.max(2, Math.round(size * 0.24));
  const armLength = Math.max(3, Math.round(size * 0.2));
  const thickness = Math.max(2, Math.round(size * 0.09));
  const dotRadius = size * 0.1;
  const center = (size - 1) / 2;

  const inBracket = (x, y) => {
    const flippedX = Math.min(x, size - 1 - x);
    const flippedY = Math.min(y, size - 1 - y);
    return (
      (flippedX >= margin && flippedX < margin + armLength && flippedY >= margin && flippedY < margin + thickness) ||
      (flippedY >= margin && flippedY < margin + armLength && flippedX >= margin && flippedX < margin + thickness)
    );
  };

  return png(size, (x, y) => {
    // Rounded-corner alpha for the background square.
    const cx = x < radius ? radius : x > size - 1 - radius ? size - 1 - radius : x;
    const cy = y < radius ? radius : y > size - 1 - radius ? size - 1 - radius : y;
    const cornerDist = Math.hypot(x - cx, y - cy);
    const alpha = Math.round(255 * Math.min(1, Math.max(0, radius - cornerDist + 1)));
    if (alpha === 0) return [0, 0, 0, 0];

    const dotDist = Math.hypot(x - center, y - center);
    const dotMix = Math.min(1, Math.max(0, dotRadius - dotDist + 0.5));
    if (dotMix > 0 || inBracket(x, y)) {
      const mix = inBracket(x, y) ? 1 : dotMix;
      return [
        Math.round(BG[0] + (FG[0] - BG[0]) * mix),
        Math.round(BG[1] + (FG[1] - BG[1]) * mix),
        Math.round(BG[2] + (FG[2] - BG[2]) * mix),
        alpha
      ];
    }
    return [...BG, alpha];
  });
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote ${file}`);
}
