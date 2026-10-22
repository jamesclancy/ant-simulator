// Generates the app icon + splash sources in ../assets from the pixel ant mark (the same one the
// PWA icons use, see apps/web/scripts/brand.mjs). Replace the PNGs in assets/ with final art
// (same names/sizes) and run `pnpm --filter @ant/mobile assets`.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { COLORS, renderMark } from '../../web/scripts/brand.mjs';

const out = fileURLToPath(new URL('../assets/', import.meta.url));

/** RGBA mark -> PNG; `bg` paints a flat colour behind it, `lawn` the pixel lawn. */
async function render(name, size, opts, flat = null) {
  const rgba = Buffer.from(renderMark(size, opts));
  let img = sharp(rgba, { raw: { width: size, height: size, channels: 4 } });
  if (flat !== null)
    img = sharp({ create: { width: size, height: size, channels: 4, background: flat } }).composite(
      [{ input: await img.png().toBuffer() }],
    );
  await img.png().toFile(out + name);
}

await mkdir(out, { recursive: true });
const dark = { r: 0x1d, g: 0x33, b: 0x16, alpha: 1 };
// Square icon with its own pixel lawn (iOS, legacy Android).
await render('icon-only.png', 1024, { bg: true, scale: 1 });
// Android adaptive icon: foreground stays inside the central safe zone, on its own layer.
await render('icon-foreground.png', 1024, { scale: 0.62, ring: false });
await render('icon-background.png', 1024, { bg: true, scale: 0 });
// Splash: the mark in the middle of a dark lawn colour.
await render('splash.png', 2732, { scale: 0.34 }, dark);
await render('splash-dark.png', 2732, { scale: 0.34 }, dark);
console.log('wrote', out, COLORS.ring.toString(16));
