import type { Command, PlayerInfo, SimEvent } from '@ant/shared';
import { haptics } from '../platform/haptics';

/** Pointer movement (px) beyond which a press is a pan, not a tap. */
const TAP_SLOP = 8;
const JOY_RADIUS = 56;
/** Hold this long (ms) without moving for a long-press. */
const LONG_PRESS_MS = 550;

const KEY_DIRS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

export interface PlayerInputOptions {
  host: HTMLElement;
  send(commands: Command[]): void;
  /** Screen (client) coordinates -> world coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  /** True while another tool (e.g. place food) owns taps. */
  toolActive(): boolean;
  /** A move-to tap landed at this world point. */
  onTarget(x: number, y: number): void;
  /** False while a menu is open: keyboard shortcuts are ignored. */
  keysEnabled?(): boolean;
  /** A finger held still on the ground (not on a HUD control); the tap that follows is dropped. */
  onLongPress?(x: number, y: number): void;
}

/**
 * Player controls: tap/click to move, WASD/arrows, virtual joystick on coarse pointers,
 * HUD buttons, keyboard shortcuts (Shift = trail while held, R = recruit 5, E = pickup/drop)
 * and the camera follow toggle. Sends commands only when the intent changes.
 */
export class PlayerInput {
  /** Camera follows the player. Auto-disabled when the user pans; the Follow button re-enables. */
  follow = true;
  private opts: PlayerInputOptions;
  private keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private sentDir = { x: 0, y: 0 };
  private trailToggle = false;
  private shift = false;
  private sentTrail = false;
  private el = {
    trail: byId('p-trail'),
    pickup: byId('p-pickup'),
    r5: byId('p-recruit5'),
    r10: byId('p-recruit10'),
    release: byId('p-release'),
    follow: byId('p-follow'),
    status: byId<HTMLElement>('p-status'),
    toast: byId<HTMLElement>('toast'),
  };
  private toastTimer = 0;

  constructor(opts: PlayerInputOptions) {
    this.opts = opts;
    this.bindButtons();
    this.bindPointer();
    this.bindKeys();
    // Always mounted: the joystick setting (auto / on / off, side) is applied in CSS.
    this.mountJoystick();
    this.setFollow(true);
  }

  setFollow(on: boolean): void {
    this.follow = on;
    this.el.follow.setAttribute('aria-pressed', String(on));
  }

  /** Highlight the Pick up button while a food pile is within reach. */
  setFoodInReach(on: boolean): void {
    this.el.pickup.classList.toggle('ready', on);
  }

  /** Reflect sim state in the HUD and show toasts for events. */
  onSnapshot(player: PlayerInfo | null, events: readonly SimEvent[]): void {
    const { el } = this;
    el.trail.setAttribute('aria-pressed', String(player?.trail ?? false));
    el.pickup.textContent = player && player.carrying > 0 ? 'Drop' : 'Pick up';
    el.release.disabled = !player || player.recruits === 0;
    el.status.textContent = player ? `Recruits ${player.recruits}` : '';
    for (const ev of events) {
      if (ev.type === 'playerSwapped') this.toast('Your ant was lost — swapped to another ant');
    }
  }

  toast(text: string): void {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 3000);
  }

  private bindButtons(): void {
    const { el } = this;
    el.trail.addEventListener('click', () => {
      this.trailToggle = !this.trailToggle;
      this.syncTrail();
    });
    el.pickup.addEventListener('click', () => {
      haptics.light();
      this.opts.send([{ type: 'playerPickupDrop' }]);
    });
    el.r5.addEventListener('click', () => {
      haptics.light();
      this.opts.send([{ type: 'playerRecruit', count: 5 }]);
    });
    el.r10.addEventListener('click', () => {
      haptics.light();
      this.opts.send([{ type: 'playerRecruit', count: 10 }]);
    });
    el.release.addEventListener('click', () => this.opts.send([{ type: 'playerRelease' }]));
    el.follow.addEventListener('click', () => this.setFollow(!this.follow));
  }

  /** Effective trail = toggle button OR Shift held. */
  private syncTrail(): void {
    const on = this.trailToggle || this.shift;
    if (on !== this.sentTrail) {
      this.sentTrail = on;
      this.opts.send([{ type: 'playerToggleTrail', on }]);
    }
    this.el.trail.setAttribute('aria-pressed', String(on));
  }

  private bindPointer(): void {
    const { host } = this.opts;
    const downs = new Map<number, { x: number; y: number }>();
    let tapOk = false;
    let pressTimer = 0;
    const cancelPress = (): void => clearTimeout(pressTimer);
    host.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // A second finger turns the gesture into a pinch: never a tap.
      tapOk = downs.size === 1;
      cancelPress();
      if (this.opts.onLongPress && tapOk) {
        const { clientX: x, clientY: y } = e;
        pressTimer = window.setTimeout(() => {
          if (!tapOk || this.opts.toolActive()) return;
          tapOk = false;
          this.opts.onLongPress?.(x, y);
        }, LONG_PRESS_MS);
      }
    });
    host.addEventListener('pointermove', (e) => {
      const d = downs.get(e.pointerId);
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) <= TAP_SLOP) return;
      // Dragging pans (Camera), which hands the view back to the user.
      tapOk = false;
      cancelPress();
      if (this.follow) this.setFollow(false);
    });
    const up = (e: PointerEvent, cancelled: boolean): void => {
      const d = downs.get(e.pointerId);
      downs.delete(e.pointerId);
      cancelPress();
      if (!d || cancelled || !tapOk || downs.size > 0) return;
      tapOk = false;
      if (this.opts.toolActive()) return;
      const p = this.opts.toWorld(e.clientX, e.clientY);
      this.opts.onTarget(p.x, p.y);
      this.opts.send([{ type: 'playerMoveTo', x: p.x, y: p.y }]);
    };
    host.addEventListener('pointerup', (e) => up(e, false));
    host.addEventListener('pointercancel', (e) => up(e, true));
  }

  private bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (this.opts.keysEnabled && !this.opts.keysEnabled()) return;
      const k = e.key.toLowerCase();
      if (k === 'shift') {
        this.shift = true;
        this.syncTrail();
      } else if (k in KEY_DIRS) {
        this.keys.add(k);
        this.syncDir();
        e.preventDefault();
      } else if (!e.repeat && k === 'r') {
        haptics.light();
        this.opts.send([{ type: 'playerRecruit', count: 5 }]);
      } else if (!e.repeat && k === 'e') {
        haptics.light();
        this.opts.send([{ type: 'playerPickupDrop' }]);
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'shift') {
        this.shift = false;
        this.syncTrail();
      } else if (this.keys.delete(k)) this.syncDir();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shift = false;
      this.syncDir();
      this.syncTrail();
    });
  }

  /** Combine keyboard and joystick into one direction and send it if it changed. */
  private syncDir(): void {
    let dx = this.joy.x;
    let dy = this.joy.y;
    if (dx === 0 && dy === 0) {
      for (const k of this.keys) {
        dx += KEY_DIRS[k]![0];
        dy += KEY_DIRS[k]![1];
      }
    }
    const m = Math.hypot(dx, dy);
    if (m > 1) {
      dx /= m;
      dy /= m;
    }
    dx = Math.round(dx * 20) / 20;
    dy = Math.round(dy * 20) / 20;
    if (dx === this.sentDir.x && dy === this.sentDir.y) return;
    this.sentDir = { x: dx, y: dy };
    this.opts.send([{ type: 'playerMoveDir', dx, dy }]);
  }

  private mountJoystick(): void {
    const base = document.createElement('div');
    base.id = 'joystick';
    const knob = document.createElement('div');
    knob.id = 'joystick-knob';
    base.appendChild(knob);
    document.body.appendChild(base);
    let active = -1;
    let cx = 0;
    let cy = 0;
    const move = (e: PointerEvent): void => {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > JOY_RADIUS) {
        dx = (dx / m) * JOY_RADIUS;
        dy = (dy / m) * JOY_RADIUS;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // Small dead zone so a resting thumb doesn't drift the ant.
      const mag = Math.hypot(dx, dy) / JOY_RADIUS;
      this.joy = mag < 0.15 ? { x: 0, y: 0 } : { x: dx / JOY_RADIUS, y: dy / JOY_RADIUS };
      this.syncDir();
    };
    base.addEventListener('pointerdown', (e) => {
      if (active !== -1) return;
      active = e.pointerId;
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      move(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) move(e);
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== active) return;
      active = -1;
      knob.style.transform = '';
      this.joy = { x: 0, y: 0 };
      this.syncDir();
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }
}

function byId<T extends HTMLElement = HTMLButtonElement>(id: string): T {
  return document.getElementById(id) as T;
}

function isTyping(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    t instanceof HTMLSelectElement
  );
}
