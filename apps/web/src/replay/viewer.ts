import type { ReplayStart } from '@ant/shared';
import { TICK_RATE_HZ } from '@ant/shared';
import { h } from '../ui/dom';
import './replay.css';

export const REPLAY_SPEEDS = [1, 2, 4, 8, 16] as const;

export interface ReplayViewerHooks {
  setPaused(paused: boolean): void;
  setSpeed(speed: number): void;
  seek(tick: number): void;
  setFollow(on: boolean): void;
  exit(): void;
}

const clock = (ticks: number): string => {
  const s = Math.max(0, Math.floor(ticks / TICK_RATE_HZ));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Transport bar of the replay viewer: play/pause, speed, seek, follow camera, exit. */
export class ReplayViewer {
  private readonly bar = h('div', { id: 'replay-bar', hidden: true, role: 'group' });
  private readonly banner = h('div', { id: 'replay-banner', role: 'alert', hidden: true });
  private readonly playBtn = h('button', { type: 'button', id: 'replay-play' }, 'Pause');
  private readonly scrub = h('input', {
    type: 'range',
    id: 'replay-scrub',
    min: '0',
    max: '1',
    step: '1',
    value: '0',
    'aria-label': 'Replay position',
  });
  private readonly time = h('span', { id: 'replay-time' }, '0:00 / 0:00');
  private readonly followBtn = h('button', { type: 'button', id: 'replay-follow' }, 'Follow ant');
  private readonly speedBtns = new Map<number, HTMLButtonElement>();
  private info: ReplayStart | null = null;
  private paused = false;
  private speed = 1;
  private follow = false;
  private dragging = false;
  private seeking = false;
  private tick = 0;
  private desynced = false;

  constructor(private readonly hooks: ReplayViewerHooks) {
    const speeds = h('div', { class: 'replay-speeds', role: 'group', 'aria-label': 'Speed' });
    for (const s of REPLAY_SPEEDS) {
      const b = h('button', { type: 'button', 'data-speed': String(s) }, `${s}x`);
      b.addEventListener('click', () => this.setSpeed(s));
      this.speedBtns.set(s, b);
      speeds.append(b);
    }
    const exit = h('button', { type: 'button', id: 'replay-exit' }, 'Exit');
    exit.addEventListener('click', () => hooks.exit());
    this.playBtn.addEventListener('click', () => this.toggle());
    this.followBtn.addEventListener('click', () => this.setFollow(!this.follow));
    this.scrub.addEventListener('input', () => {
      this.dragging = true;
      this.time.textContent = this.label(Number(this.scrub.value));
    });
    this.scrub.addEventListener('change', () => {
      this.dragging = false;
      this.requestSeek(Number(this.scrub.value));
    });
    this.bar.append(
      h('div', { class: 'replay-row' }, this.playBtn, speeds, this.followBtn, exit),
      h('div', { class: 'replay-row' }, this.scrub, this.time),
    );
    document.body.append(this.banner, this.bar);
  }

  get endTick(): number {
    return this.info?.endTick ?? 0;
  }

  get active(): boolean {
    return !this.bar.hidden;
  }

  private label(tick: number): string {
    return `${clock(tick - (this.info?.startTick ?? 0))} / ${clock((this.info?.endTick ?? 0) - (this.info?.startTick ?? 0))}`;
  }

  start(info: ReplayStart): void {
    this.info = info;
    this.paused = false;
    this.speed = 1;
    this.tick = info.startTick;
    this.desynced = false;
    this.seeking = false;
    this.scrub.min = String(info.startTick);
    this.scrub.max = String(info.endTick);
    this.scrub.value = String(info.startTick);
    this.time.textContent = this.label(info.startTick);
    this.bar.hidden = false;
    document.body.classList.add('in-replay');
    this.setFollow(false);
    this.sync();
    this.hooks.setSpeed(1);
    this.hooks.setPaused(false);
    if (info.versionMismatch) {
      this.showBanner(
        'This replay was recorded by a different game version. It may not play back exactly.',
      );
    } else {
      this.banner.hidden = true;
    }
  }

  stop(): void {
    this.bar.hidden = true;
    this.banner.hidden = true;
    this.info = null;
    document.body.classList.remove('in-replay');
  }

  /** Every snapshot: advance the scrubber (unless being dragged) and detect the end. */
  onSnapshot(tick: number): void {
    if (!this.info) return;
    this.tick = tick;
    this.seeking = false;
    if (!this.dragging) {
      this.scrub.value = String(tick);
      this.time.textContent = this.label(tick);
    }
    if (tick >= this.info.endTick && !this.paused && !this.desynced) {
      this.paused = true;
      this.hooks.setPaused(true);
    }
    this.sync();
  }

  onStatus(tick: number, seeking: boolean): void {
    this.seeking = seeking;
    if (seeking) {
      this.scrub.value = String(tick);
      this.time.textContent = `Seeking… ${this.label(tick)}`;
    }
    this.sync();
  }

  onDesync(tick: number): void {
    this.desynced = true;
    this.paused = true;
    this.showBanner(
      `Replay out of sync at ${clock(tick - (this.info?.startTick ?? 0))}: this game no longer plays back the way it was recorded (a game update changed the simulation, or the file was edited). Playback stopped.`,
    );
    this.sync();
  }

  private showBanner(text: string): void {
    this.banner.textContent = text;
    this.banner.hidden = false;
  }

  private toggle(): void {
    if (this.info && this.tick >= this.info.endTick) {
      // Play again from the start.
      this.requestSeek(this.info.startTick);
      this.paused = false;
      this.hooks.setPaused(false);
    } else {
      this.paused = !this.paused;
      this.hooks.setPaused(this.paused);
    }
    this.sync();
  }

  private requestSeek(tick: number): void {
    this.desynced = false;
    this.banner.hidden = !this.info?.versionMismatch;
    this.seeking = true;
    this.hooks.seek(tick);
    this.sync();
  }

  private setSpeed(speed: number): void {
    this.speed = speed;
    this.hooks.setSpeed(speed);
    this.sync();
  }

  setFollow(on: boolean): void {
    this.follow = on;
    this.hooks.setFollow(on);
    this.sync();
  }

  /** The camera stopped following because the user panned. */
  followCleared(): void {
    if (this.follow) {
      this.follow = false;
      this.sync();
    }
  }

  private sync(): void {
    const ended = !!this.info && this.tick >= this.info.endTick;
    this.playBtn.textContent = ended ? 'Replay' : this.paused ? 'Play' : 'Pause';
    this.followBtn.setAttribute('aria-pressed', String(this.follow));
    for (const [s, b] of this.speedBtns) b.setAttribute('aria-pressed', String(s === this.speed));
    this.bar.classList.toggle('seeking', this.seeking);
  }
}
