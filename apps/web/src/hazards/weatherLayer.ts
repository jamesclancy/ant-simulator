import { Container, Graphics, Sprite } from 'pixi.js';
import type { Snapshot } from '@ant/shared';
import type { Art } from '../art';

const DROPS = 220;
const TINT = 0x0d2238;
const MAX_TINT_ALPHA = 0.45;
const SLANT = 0.18;
/** Screen pixels per art pixel for drops and splashes. */
const PX = 2;
const SPLASHES = 36;
const SPLASH_MS = 240;

/**
 * Rain over the surface view, in screen space (it does not move with the camera): a dark
 * blue tint and slanted streaks falling fast, both following the sim's rain intensity,
 * which ramps up and down on its own. With reduced motion only the tint is drawn.
 */
export class WeatherLayer {
  readonly view = new Container();
  private readonly tint = new Graphics();
  private readonly streaks = new Container();
  private readonly drops: Sprite[] = [];
  private readonly splashes: { s: Sprite; born: number }[] = [];
  private splashAt = 0;
  private readonly px = new Float32Array(DROPS);
  private readonly py = new Float32Array(DROPS);
  private readonly speed = new Float32Array(DROPS);
  private readonly len = new Float32Array(DROPS);
  private target = 0;
  private shown = 0;
  private w = 0;
  private h = 0;
  private reduceMotion = false;

  constructor(
    parent: Container,
    private readonly screen: { width: number; height: number },
    private readonly art: Art,
  ) {
    this.view.addChild(this.tint, this.streaks);
    for (let i = 0; i < DROPS; i++) {
      const d = new Sprite(art.rain.drops[i % art.rain.drops.length]);
      d.scale.set(PX);
      d.visible = false;
      this.drops.push(d);
      this.streaks.addChild(d);
    }
    for (let i = 0; i < SPLASHES; i++) {
      const s = new Sprite(art.rain.splash[0]);
      s.scale.set(PX);
      s.anchor.set(0.5, 1);
      s.visible = false;
      this.splashes.push({ s, born: -Infinity });
      this.streaks.addChild(s);
    }
    this.view.visible = false;
    this.view.eventMode = 'none';
    parent.addChild(this.view);
    // Deterministic scatter, so a reload looks the same.
    for (let i = 0; i < DROPS; i++) {
      this.px[i] = frac(i * 0.618034) * 2000;
      this.py[i] = frac(i * 0.414214) * 1200;
      this.speed[i] = 14 + frac(i * 0.732) * 10;
      this.len[i] = 10 + frac(i * 0.271) * 14;
    }
  }

  get intensity(): number {
    return this.shown;
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** Hide while the nest view is up. */
  setVisible(visible: boolean): void {
    this.view.visible = visible && this.shown > 0.01;
    this.visible = visible;
  }
  private visible = true;

  update(snapshot: Snapshot): void {
    this.target = snapshot.weather.raining ? snapshot.weather.intensity : 0;
  }

  /** Call every frame with the frame time in ms. */
  tick(dtMs: number): void {
    const k = 1 - Math.exp(-dtMs / 400);
    this.shown += (this.target - this.shown) * k;
    if (Math.abs(this.target - this.shown) < 0.005) this.shown = this.target;
    this.view.visible = this.visible && this.shown > 0.01;
    if (!this.view.visible) return;
    const { width, height } = this.screen;
    if (width !== this.w || height !== this.h) {
      this.w = width;
      this.h = height;
    }
    this.tint
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: TINT, alpha: MAX_TINT_ALPHA * this.shown });
    const now = performance.now();
    for (const sp of this.splashes) {
      const age = now - sp.born;
      sp.s.visible = !this.reduceMotion && age < SPLASH_MS;
      if (sp.s.visible)
        sp.s.texture = this.art.rain.splash[Math.min(2, Math.floor((age / SPLASH_MS) * 3))]!;
    }
    if (this.reduceMotion) {
      for (const d of this.drops) d.visible = false;
      return;
    }
    const step = dtMs / 16.7;
    const active = Math.floor(DROPS * this.shown);
    for (let i = 0; i < DROPS; i++) {
      const d = this.drops[i]!;
      d.visible = i < active;
      if (!d.visible) continue;
      let x = this.px[i]!;
      let y = this.py[i]! + this.speed[i]! * step;
      x += this.speed[i]! * SLANT * step;
      if (y > height || x > width) {
        // Landing: a ring splash where the drop hit, then the drop restarts above the screen.
        if (y > height && i % 3 === 0) {
          const sp = this.splashes[this.splashAt++ % SPLASHES]!;
          sp.born = now;
          sp.s.position.set(
            Math.round(Math.min(x, width) / PX) * PX,
            Math.round(height - (i % 7) * 18),
          );
        }
        y = -this.len[i]!;
        x = (x * 7.31 + i * 53) % (width + 80);
        x -= 40;
      }
      this.px[i] = x;
      this.py[i] = y;
      d.position.set(Math.round(x / PX) * PX, Math.round(y / PX) * PX);
      d.alpha = 0.85 * this.shown;
    }
  }
}

function frac(v: number): number {
  return v - Math.floor(v);
}
