// Generates the placeholder app icon + splash sources in ../assets from a simple SVG ant mark.
// Replace the PNGs in assets/ with final art (same names/sizes) and run `pnpm --filter @ant/mobile assets`.
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../assets/', import.meta.url));
const BG = '#2f4a2a';
const BG_DARK = '#1b2a1b';

/** Ant glyph centred at 0,0, roughly 520 units wide, head pointing right. */
const ant = (ink) => `
  <g stroke="${ink}" stroke-width="22" stroke-linecap="round" fill="none">
    <path d="M-60,-20 L-110,-150 M0,-10 L10,-170 M60,-20 L120,-140"/>
    <path d="M-60,20 L-110,150 M0,10 L10,170 M60,20 L120,140"/>
    <path d="M190,-30 Q250,-110 310,-100 M190,30 Q250,110 310,100"/>
  </g>
  <g fill="${ink}">
    <ellipse cx="-170" cy="0" rx="130" ry="95"/>
    <ellipse cx="0" cy="0" rx="75" ry="62"/>
    <ellipse cx="150" cy="0" rx="85" ry="78"/>
  </g>`;

const svg = (size, { bg, scale, ink = '#111', extra = '' }) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ''}
  ${extra}
  <g transform="translate(${size / 2 - 20 * scale} ${size / 2}) scale(${scale})">${ant(ink)}</g>
</svg>`;

// A yellow ring echoes the in-game player marker.
const ring = (size, r) =>
  `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#ffd400" stroke-width="${size / 60}" opacity="0.85"/>`;

const render = (name, markup) =>
  sharp(Buffer.from(markup))
    .png()
    .toFile(out + name);

await mkdir(out, { recursive: true });
// Square icon with its own background (iOS, legacy Android).
await render('icon-only.png', svg(1024, { bg: BG, scale: 1.25, extra: ring(1024, 420) }));
// Android adaptive icon: foreground stays inside the central 66% safe zone.
await render('icon-foreground.png', svg(1024, { scale: 0.95, ink: '#111' }));
await render('icon-background.png', svg(1024, { bg: BG }));
// Splash: mark on the game's ground colour, plus a dark variant.
await render('splash.png', svg(2732, { bg: BG_DARK, scale: 1.6, ink: '#e8f0e8' }));
await render('splash-dark.png', svg(2732, { bg: BG_DARK, scale: 1.6, ink: '#e8f0e8' }));
console.log('wrote', out);
