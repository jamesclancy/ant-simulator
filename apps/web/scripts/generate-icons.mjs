// Generates the PWA icons (the pixel ant mark on a pixel lawn) with no image dependencies.
// Run: node apps/web/scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

import { renderMark } from './brand.mjs';

function crc32(buf) {
  let c;
  let crc = ~0;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** `rounded`: transparent rounded-square corners ("any" icons); maskable/apple icons are full bleed. */
function png(size, { scale, rounded }) {
  const mark = renderMark(size, { bg: true, scale });
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = Math.round((size * 0.2) / 4) * 4;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const m = (py * size + px) * 4;
      // Corners are cut in steps (not an arc) to stay pixel-art.
      const cx = Math.min(Math.max(px, radius), size - 1 - radius);
      const cy = Math.min(Math.max(py, radius), size - 1 - radius);
      const inside = !rounded || Math.abs(px - cx) + Math.abs(py - cy) <= radius * 0.6;
      raw[o] = mark[m];
      raw[o + 1] = mark[m + 1];
      raw[o + 2] = mark[m + 2];
      raw[o + 3] = inside ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const icons = [
  ['icon-192.png', 192, { scale: 1, rounded: true }],
  ['icon-512.png', 512, { scale: 1, rounded: true }],
  // Maskable: full-bleed background, ant within the central 80% safe zone.
  ['icon-maskable-512.png', 512, { scale: 0.72, rounded: false }],
  ['apple-touch-icon.png', 180, { scale: 0.85, rounded: false }],
  ['favicon-32.png', 32, { scale: 1, rounded: true }],
];
for (const [name, size, opts] of icons) writeFileSync(join(out, name), png(size, opts));
console.log(`wrote ${icons.length} icons to ${out}`);
