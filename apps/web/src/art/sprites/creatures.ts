import type { Texture } from 'pixi.js';
import type { Atlas } from '../atlas';
import { T } from '../palette';
import type { Px } from '../pixels';
import { hash2, lighten, darken } from '../pixels';

export const SPIDER_SIZE = 47;
export const SPIDER_WALK_FRAMES = 4;

function drawSpider(px: Px, frame: number, crouch: boolean): void {
  const c = (SPIDER_SIZE - 1) / 2;
  const [ink, body, hi, glint] = T.spider;
  // Legs first so the body covers their roots: femur then tibia, tetrapod gait.
  const L1 = crouch ? 6 : 9.5;
  const L2 = crouch ? 7 : 12;
  const angles = [0.7, 1.35, 1.95, 2.55];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const group = (i + (s > 0 ? 0 : 1)) % 2;
      const swing = crouch ? 0 : Math.sin(((frame + group * 2) / 4) * Math.PI * 2) * 0.28;
      const a = angles[i]! + swing;
      const bx = c + 5.5 - i * 3.2;
      const kx = bx + Math.cos(a) * L1 * (i < 2 ? 1 : 0.9);
      const ky = c + s * Math.sin(a) * L1;
      const tx = kx + Math.cos(a + 0.45) * L2 * 0.8;
      const ty = ky + s * Math.sin(a + 0.15) * L2;
      px.line(bx, c + s * 2.5, kx, ky, ink);
      px.line(kx, ky, tx, ty, ink);
      px.set(tx, ty, body);
    }
  }
  px.ellipse(c - 7, c, 8.4, 6.6, (x, y, u, v) => {
    // Hourglass marking on the back.
    if (Math.abs(u) < 0.5 && Math.abs(v) < 0.5 - Math.abs(u) * 0.5 && v * v + u * u * 0.3 < 0.2)
      return T.spiderEye;
    return v < -0.4 ? hi : v > 0.45 ? ink : (x + y) % 5 === 0 ? hi : body;
  });
  px.ellipse(c + 3.5, c, 5.6, 4.8, (_x, _y, _u, v) => (v < -0.4 ? glint : v > 0.4 ? ink : hi));
  px.outline(0x070309);
  for (const s of [-1, 1]) {
    px.rect(c + 7, c + s * 2, 2, 1, T.spiderEye);
    px.set(c + 9, c + s * 3.5, T.spiderEye);
    // Fangs.
    px.line(c + 9, c + s * 1, c + 11, c + s * 1, 0xd8c8a8);
  }
}

export interface SpiderTextures {
  walk: Texture[];
  crouch: Texture;
}

export function registerSpider(atlas: Atlas): SpiderTextures {
  const walk = Array.from({ length: SPIDER_WALK_FRAMES }, (_, f) =>
    atlas.define(`spider/walk/${f}`, SPIDER_SIZE, SPIDER_SIZE, (px) => drawSpider(px, f, false)),
  );
  const crouch = atlas.define('spider/crouch', SPIDER_SIZE, SPIDER_SIZE, (px) =>
    drawSpider(px, 0, true),
  );
  return { walk, crouch };
}

/** Sand cone `r` art pixels in radius: stepped rings darkening to the middle, two shimmer frames. */
export function pitTexture(atlas: Atlas, r: number, frame: 0 | 1 | 2): Texture {
  const size = r * 2 + 3;
  return atlas.define(`pit/${r}/${frame}`, size, size, (px) => {
    const c = r + 1;
    const dead = frame === 2;
    px.ellipse(c, c, r, r, (x, y, u, v) => {
      const d = Math.hypot(u, v);
      if (dead) {
        const k = hash2(x, y, 7);
        return d > 0.5 ? (k > 0.85 ? T.sand[4] : T.sand[3]) : T.sand[3] + 0 * k;
      }
      const ring = Math.min(4, Math.floor((1 - d) * 5));
      // Sliding grains: a dither that rotates half a step between the two frames.
      const ang = Math.atan2(v, u) + d * 5 + frame * Math.PI;
      const grain = Math.sin(ang * 3) > 0.82 && d > 0.15;
      const tone = T.sand[Math.max(0, Math.min(4, 4 - ring))]!;
      return grain ? darken(tone, 0.22) : tone;
    });
    px.outline(dead ? T.sand[2] : T.sand[1]);
    if (dead) px.ellipse(c, c, r * 0.3, r * 0.3, T.sand[2]);
  });
}

export function jawTextures(atlas: Atlas): Texture[] {
  return [0, 1].map((open) =>
    atlas.define(`pit/jaws/${open}`, 13, 11, (px) => {
      const w = open ? 4 : 2;
      for (const s of [-1, 1]) {
        px.line(6 + s, 9, 6 + s * w, 4, T.jaw);
        px.line(6 + s * w, 4, 6 + s * (w - 1), 1, T.jaw);
        px.set(6 + s * (w - 1), 1, lighten(T.jaw, 0.5));
      }
      px.rect(5, 8, 3, 2, darken(T.jaw, 0.2));
    }),
  );
}
