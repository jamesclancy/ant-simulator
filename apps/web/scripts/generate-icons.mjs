// Generates the placeholder PWA icons (a simple ant on dark green) with no image dependencies.
// Run: node apps/web/scripts/generate-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const BG = [0x1b, 0x2a, 0x1b];
const FG = [0xe8, 0xd9, 0xb0];
const SS = 3;

/** Unit-square coordinates (0..1); the ant is drawn inside `scale` of the canvas, centered. */
function inAnt(x, y, scale) {
  const u = (x - 0.5) / scale;
  const v = (y - 0.5) / scale;
  const ell = (cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
  if (ell(0, -0.27, 0.11, 0.1)) return true; // head
  if (ell(0, -0.07, 0.1, 0.11)) return true; // thorax
  if (ell(0, 0.24, 0.16, 0.21)) return true; // abdomen
  const seg = (x1, y1, x2, y2, w) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((u - x1) * dx + (v - y1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(u - (x1 + t * dx), v - (y1 + t * dy)) <= w;
  };
  for (const s of [-1, 1]) {
    if (seg(s * 0.05, -0.34, s * 0.2, -0.46, 0.014)) return true; // antennae
    if (seg(s * 0.08, -0.12, s * 0.3, -0.24, 0.016)) return true; // legs
    if (seg(s * 0.09, -0.06, s * 0.36, -0.04, 0.016)) return true;
    if (seg(s * 0.08, 0.0, s * 0.3, 0.2, 0.016)) return true;
  }
  return false;
}

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
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const radius = size * 0.2;
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let ant = 0;
      let inside = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS;
          const fy = py + (sy + 0.5) / SS;
          if (inAnt(fx / size, fy / size, scale)) ant++;
          const cx = Math.min(Math.max(fx, radius), size - radius);
          const cy = Math.min(Math.max(fy, radius), size - radius);
          if (!rounded || Math.hypot(fx - cx, fy - cy) <= radius) inside++;
        }
      }
      const n = SS * SS;
      const a = ant / n;
      const o = py * (size * 4 + 1) + 1 + px * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] * (1 - a) + FG[i] * a);
      raw[o + 3] = Math.round((inside / n) * 255);
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
  ['icon-192.png', 192, { scale: 0.9, rounded: true }],
  ['icon-512.png', 512, { scale: 0.9, rounded: true }],
  // Maskable: full-bleed background, ant within the central 80% safe zone.
  ['icon-maskable-512.png', 512, { scale: 0.72, rounded: false }],
  ['apple-touch-icon.png', 180, { scale: 0.85, rounded: false }],
  ['favicon-32.png', 32, { scale: 0.9, rounded: true }],
];
for (const [name, size, opts] of icons) writeFileSync(join(out, name), png(size, opts));
console.log(`wrote ${icons.length} icons to ${out}`);
