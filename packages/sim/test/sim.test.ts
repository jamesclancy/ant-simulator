import { describe, expect, it } from 'vitest';
import { ANT_LAYER_OFFSET, ANT_STRIDE } from '@ant/shared';
import type { Command } from '@ant/shared';
import { createRng, createSim } from '../src';

const cfg = {
  seed: 42,
  worldSize: 512,
  initialAnts: 200,
  colonies: 1,
  spiders: 0,
  colony: { maxLayRate: 0 }, // keep the population fixed
};

function run(commands: Record<number, Command[]>, ticks: number) {
  const sim = createSim(cfg);
  for (let t = 0; t < ticks; t++) {
    const cmds = commands[t];
    if (cmds) sim.applyCommands(cmds);
    sim.step();
  }
  return sim.snapshot();
}

describe('rng', () => {
  it('is deterministic per seed and in [0, 1)', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = a.next();
      expect(v).toBe(b.next());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
});

describe('sim', () => {
  it('advances one tick per step', () => {
    const sim = createSim(cfg);
    expect(sim.tick).toBe(0);
    sim.step();
    sim.step();
    expect(sim.tick).toBe(2);
    expect(sim.snapshot().tick).toBe(2);
  });

  it('spawns the configured ants and keeps them in bounds', () => {
    const sim = createSim(cfg);
    for (let i = 0; i < 500; i++) sim.step();
    const snap = sim.snapshot();
    expect(snap.antCount).toBe(200);
    expect(snap.ants.length).toBe(200 * ANT_STRIDE);
    for (let i = 0; i < snap.antCount; i++) {
      // Underground ants live in nest-grid space, not world space.
      if (snap.ants[i * ANT_STRIDE + ANT_LAYER_OFFSET] !== 0) continue;
      expect(snap.ants[i * ANT_STRIDE]!).toBeGreaterThanOrEqual(0);
      expect(snap.ants[i * ANT_STRIDE]!).toBeLessThanOrEqual(512);
      expect(snap.ants[i * ANT_STRIDE + 1]!).toBeGreaterThanOrEqual(0);
      expect(snap.ants[i * ANT_STRIDE + 1]!).toBeLessThanOrEqual(512);
    }
  });

  it('moves ants', () => {
    const sim = createSim(cfg);
    const before = sim.snapshot();
    sim.step();
    expect(sim.snapshot().ants).not.toEqual(before.ants);
  });

  it('is deterministic: same seed + commands => identical snapshots', () => {
    const commands = {
      10: [{ type: 'spawnAnts', count: 50, x: 100, y: 100 }] as Command[],
      30: [{ type: 'spawnAnts', count: 10, x: 400, y: 50 }] as Command[],
    };
    const a = run(commands, 100);
    const b = run(commands, 100);
    expect(a.antCount).toBe(260);
    expect(a).toEqual(b);
  });

  it('diverges with a different seed or different commands', () => {
    const base = run({}, 20);
    const other = createSim({ ...cfg, seed: 43 });
    for (let i = 0; i < 20; i++) other.step();
    expect(other.snapshot().ants).not.toEqual(base.ants);
    expect(run({ 5: [{ type: 'clearAnts' }] }, 20).antCount).toBe(0);
  });
});
