import { describe, expect, it } from 'vitest';
import { ANT_STRIDE, SpiderState } from '@ant/shared';
import {
  AudioDirector,
  EVENT_CUES,
  type AudioSnapshot,
  type DirectorContext,
} from '../src/audio/director';
import { SCORES, noteMidi, parsePattern } from '../src/audio/score';
import { JINGLES, SFX_PARAMS, renderAll, renderSfx } from '../src/audio/synth';
import { SFX_IDS, type AudioBackend, type PlayOptions, type SfxId } from '../src/audio/types';

class FakeBackend implements AudioBackend {
  plays: { id: SfxId; options: PlayOptions }[] = [];
  loops: Record<string, number> = {};
  music: { track: string | null; intensity: number }[] = [];
  play(id: SfxId, options: PlayOptions = {}): void {
    this.plays.push({ id, options });
  }
  setLoop(id: 'rain' | 'skitter' | 'mower', level: number): void {
    this.loops[id] = level;
  }
  setMusic(track: 'menu' | 'game' | null, intensity: number): void {
    this.music.push({ track, intensity });
  }
  setVolumes(): void {}
  setSuspended(): void {}
  count(id: SfxId): number {
    return this.plays.filter((p) => p.id === id).length;
  }
}

const colony = (over: Record<string, unknown> = {}) => ({
  id: 0,
  nest: { x: 0, y: 0, radius: 40 },
  fighting: 0,
  losses: 0,
  openTiles: 10,
  intruders: 0,
  raid: false,
  ...over,
});

function snap(over: Partial<Record<keyof AudioSnapshot, unknown>> = {}, tick = 1): AudioSnapshot {
  return {
    tick,
    antCount: 0,
    ants: new Float32Array(0),
    player: {
      index: 0,
      x: 500,
      y: 500,
      heading: 0,
      carrying: 0,
      trail: false,
      recruits: 0,
      recruitedIndices: new Uint32Array(0),
    },
    events: [],
    colonies: [colony(), colony({ id: 1 })],
    spiders: [],
    weather: { raining: false, intensity: 0, ticksToRain: -1 },
    winner: -1,
    ...over,
  } as unknown as AudioSnapshot;
}

const ctx = (over: Partial<DirectorContext> = {}): DirectorContext => ({
  mode: 'playing',
  layer: 0,
  paused: false,
  zoom: 1,
  view: { x: 500, y: 500, halfWidth: 400 },
  ...over,
});

function setup() {
  const backend = new FakeBackend();
  let t = 0;
  const director = new AudioDirector(backend, { now: () => t, random: () => 0.5 });
  const advance = (ms: number): void => {
    t += ms;
  };
  return { backend, director, advance };
}

describe('synth', () => {
  it('renders every sound finite, bounded and audible', () => {
    const bank = renderAll();
    for (const id of SFX_IDS) {
      const pcm = bank[id];
      expect(pcm.length, id).toBeGreaterThan(100);
      expect(pcm.length, id).toBeLessThan(22050 * 3);
      let peak = 0;
      for (const v of pcm) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, id).toBeGreaterThan(0.02);
      expect(peak, id).toBeLessThanOrEqual(1);
    }
  });
  it('is deterministic', () => {
    expect(renderSfx(SFX_PARAMS.fight)).toEqual(renderSfx(SFX_PARAMS.fight));
  });
  it('has jingles for victory and defeat', () => {
    expect(Object.keys(JINGLES).sort()).toEqual(['defeat', 'victory']);
  });
});

describe('score', () => {
  it('parses notes, rests and holds', () => {
    expect(noteMidi('a4')).toBe(69);
    expect(noteMidi('c#5')).toBe(73);
    expect(parsePattern('a4 . c5 - -')).toEqual([
      { step: 0, midi: 69, len: 1 },
      { step: 2, midi: 72, len: 3 },
    ]);
  });
  it('keeps every note inside its loop', () => {
    for (const score of Object.values(SCORES)) {
      for (const part of [score.lead, score.bass, score.arp]) {
        for (const n of part) expect(n.step + n.len).toBeLessThanOrEqual(score.steps);
      }
    }
  });
});

describe('AudioDirector', () => {
  it('stays silent on the first snapshot (baseline) and while in the menu', () => {
    const { backend, director } = setup();
    director.onSnapshot(snap({ player: { ...snap().player, carrying: 1 } }), ctx());
    expect(backend.plays).toEqual([]);
    director.onSnapshot(snap(), ctx({ mode: 'menu' }));
    expect(backend.music.at(-1)).toEqual({ track: 'menu', intensity: 0 });
    expect(backend.plays).toEqual([]);
  });

  it('maps player actions to sounds', () => {
    const { backend, director, advance } = setup();
    const p = (over: object) => ({ ...snap().player!, ...over });
    director.onSnapshot(snap(), ctx());
    director.onSnapshot(snap({ player: p({ carrying: 1 }) }, 2), ctx());
    expect(backend.count('pickup')).toBe(1);
    advance(500);
    director.onSnapshot(snap({ player: p({ carrying: 0, x: 500 }) }, 3), ctx());
    expect(backend.count('drop')).toBe(1);
    advance(500);
    director.onSnapshot(snap({ player: p({ carrying: 1 }) }, 4), ctx());
    advance(500);
    director.onSnapshot(snap({ player: p({ carrying: 0, x: 10, y: 10 }) }, 5), ctx());
    expect(backend.count('deposit')).toBe(1);
    director.onSnapshot(snap({ player: p({ recruits: 5, trail: true }) }, 6), ctx());
    expect(backend.count('recruit')).toBe(1);
    expect(backend.count('trailOn')).toBe(1);
    advance(500);
    director.onSnapshot(snap({ player: p({ recruits: 5, trail: false }) }, 7), ctx());
    expect(backend.count('trailOff')).toBe(1);
  });

  it('rate-limits fight clicks no matter how many ants fight', () => {
    const { backend, director, advance } = setup();
    director.onSnapshot(snap(), ctx());
    for (let i = 0; i < 100; i++) {
      advance(50); // 20 snapshots per second
      director.onSnapshot(
        snap({ colonies: [colony({ fighting: 4000 }), colony({ id: 1, fighting: 4000 })] }, 2 + i),
        ctx(),
      );
    }
    // 5 s of fighting at one click per 140 ms.
    expect(backend.count('fight')).toBeLessThanOrEqual(Math.ceil(5000 / 140) + 1);
    expect(backend.count('fight')).toBeGreaterThan(10);
    expect(backend.plays.length).toBeLessThan(60);
  });

  it('scales fight loudness with the fighter count and raises music intensity', () => {
    const quiet = setup();
    const loud = setup();
    for (const [h, n] of [
      [quiet, 2],
      [loud, 2000],
    ] as const) {
      h.director.onSnapshot(snap(), ctx());
      h.advance(500);
      for (let i = 0; i < 20; i++)
        h.director.onSnapshot(
          snap({ colonies: [colony({ fighting: n }), colony({ id: 1 })] }, 2 + i),
          ctx(),
        );
    }
    expect(loud.backend.plays[0]!.options.gain!).toBeGreaterThan(
      quiet.backend.plays[0]!.options.gain!,
    );
    expect(loud.backend.music.at(-1)!.intensity).toBeGreaterThan(
      quiet.backend.music.at(-1)!.intensity,
    );
    expect(loud.backend.music.at(-1)!.track).toBe('game');
  });

  it('pans and attenuates world sounds by camera position, and mutes the surface from the nest', () => {
    const { backend, director, advance } = setup();
    director.onSnapshot(snap(), ctx());
    director.onSnapshot(snap({ events: [{ type: 'spiderKilled', x: 800, y: 500 }] }, 2), ctx());
    const right = backend.plays.at(-1)!;
    expect(right.id).toBe('spiderDeath');
    expect(right.options.pan!).toBeGreaterThan(0.5);
    advance(1000);
    director.onSnapshot(snap({ events: [{ type: 'spiderKilled', x: 200, y: 500 }] }, 3), ctx());
    expect(backend.plays.at(-1)!.options.pan!).toBeLessThan(-0.4);
    advance(1000);
    director.onSnapshot(snap({ events: [{ type: 'spiderKilled', x: 5000, y: 500 }] }, 4), ctx());
    expect(backend.plays.length).toBe(2); // too far away to hear
    director.onSnapshot(
      snap({ events: [{ type: 'spiderKilled', x: 500, y: 500 }] }, 5),
      ctx({ layer: 1 }),
    );
    expect(backend.plays.at(-1)!.options.gain!).toBeLessThan(0.5);
    expect(backend.plays.at(-1)!.options.pan).toBeUndefined();
  });

  it('plays sim events through the registry and lets campaign events be mapped', () => {
    const { backend, director } = setup();
    director.onSnapshot(snap(), ctx());
    director.onSnapshot(
      snap(
        {
          events: [
            { type: 'queenKilled', colony: 0, cause: 'combat' },
            { type: 'playerEaten', cause: 'antlion' },
            { type: 'rainStarted' },
          ],
        },
        2,
      ),
      ctx(),
    );
    expect(backend.plays.map((p) => p.id)).toEqual(['queenLost', 'antlion', 'thunder']);
    expect(Object.keys(EVENT_CUES)).toContain('playerSwapped');
    director.mapEvent('matingFlight', { sfx: 'swap' });
    director.onSnapshot(snap({ events: [{ type: 'matingFlight' }] }, 3), ctx());
    expect(backend.plays.at(-1)!.id).toBe('swap');
  });

  it('hisses once when a spider starts hunting, not every snapshot', () => {
    const { backend, director, advance } = setup();
    const spider = (state: number) => ({
      id: 1,
      x: 500,
      y: 500,
      heading: 0,
      state,
      hp: 10,
      maxHp: 10,
    });
    director.onSnapshot(snap({ spiders: [spider(SpiderState.Lurk)] }), ctx());
    for (let i = 0; i < 10; i++) {
      advance(50);
      director.onSnapshot(snap({ spiders: [spider(SpiderState.Hunt)] }, 2 + i), ctx());
    }
    expect(backend.count('spiderHiss')).toBe(1);
  });

  it('plays the jingle once and stops the music at game over', () => {
    const { backend, director } = setup();
    director.onSnapshot(snap(), ctx());
    for (let i = 0; i < 3; i++) director.onSnapshot(snap({ winner: 0 }, 2 + i), ctx());
    expect(backend.count('victory')).toBe(1);
    expect(backend.music.at(-1)!.track).toBeNull();
    const lose = setup();
    lose.director.onSnapshot(snap(), ctx());
    lose.director.onSnapshot(snap({ winner: 1 }, 2), ctx());
    expect(lose.backend.count('defeat')).toBe(1);
  });

  it('derives rain and skitter beds, and silences them when paused', () => {
    const { backend, director } = setup();
    const ants = new Float32Array(1500 * ANT_STRIDE);
    director.onSnapshot(
      snap({ antCount: 1500, ants, weather: { raining: true, intensity: 0.8, ticksToRain: -1 } }),
      ctx(),
    );
    expect(backend.loops.rain).toBeCloseTo(0.8);
    expect(backend.loops.skitter).toBeGreaterThan(0.3);
    director.onSnapshot(snap({ antCount: 1500, ants }, 2), ctx({ layer: 1 }));
    expect(backend.loops.skitter).toBeLessThan(0.2);
    director.onSnapshot(snap({ antCount: 1500, ants }, 3), ctx());
    director.idle(ctx({ paused: true }));
    expect(backend.loops).toEqual({ rain: 0, skitter: 0, mower: 0 });
  });

  it('revs the engine when warned and drones as the mower passes, louder when near', () => {
    const { backend, director } = setup();
    director.onSnapshot(snap(), ctx());
    const mower = (pos: number, phase = 'mowing', startsIn = 0) => ({
      phase,
      startsIn,
      axis: 'x',
      lanes: [500],
      width: 140,
      pass: 0,
      dir: 1,
      pos,
      onField: true,
    });
    director.onSnapshot(snap({ mower: mower(0, 'warning', 150) }, 2), ctx());
    expect(backend.count('engineRise')).toBe(0);
    director.onSnapshot(snap({ mower: mower(0, 'warning', 50) }, 3), ctx());
    director.onSnapshot(snap({ mower: mower(0, 'warning', 49) }, 4), ctx());
    expect(backend.count('engineRise')).toBe(1);
    director.onSnapshot(
      snap({ mower: mower(500) }, 5),
      ctx({ view: { x: 500, y: 500, halfWidth: 300 } }),
    );
    const near = backend.loops.mower!;
    director.onSnapshot(
      snap({ mower: mower(1900) }, 6),
      ctx({ view: { x: 500, y: 500, halfWidth: 300 } }),
    );
    expect(near).toBeGreaterThan(0.9);
    expect(backend.loops.mower).toBeLessThan(near);
    director.onSnapshot(snap({}, 5), ctx());
    expect(backend.loops.mower).toBe(0);
  });

  it('resets its baseline when a new game restarts the tick counter', () => {
    const { backend, director } = setup();
    director.onSnapshot(snap({ colonies: [colony({ losses: 0 }), colony({ id: 1 })] }, 500), ctx());
    director.onSnapshot(snap({ colonies: [colony({ losses: 30 }), colony({ id: 1 })] }, 1), ctx());
    expect(backend.count('death')).toBe(0);
  });
});
