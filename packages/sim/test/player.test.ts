import { describe, expect, it } from 'vitest';
import { AntState } from '@ant/shared';
import type { Command } from '@ant/shared';
import { createSim } from '../src';

const WORLD = 1024;
const NEST = WORLD / 2;

function makeSim(opts: { ants?: number; seed?: number; pheromones?: boolean } = {}) {
  const sim = createSim({
    spiders: 0,
    antlions: 0,
    seed: opts.seed ?? 1,
    worldSize: WORLD,
    initialAnts: opts.ants ?? 300,
    colonies: 1,
    foodSources: 0,
    behavior: { pheromones: opts.pheromones ?? true },
  });
  return sim;
}

const run = (sim: ReturnType<typeof makeSim>, ticks: number, cmds: Command[] = []) => {
  sim.applyCommands(cmds);
  for (let t = 0; t < ticks; t++) sim.step();
};

const pos = (sim: ReturnType<typeof makeSim>) => {
  const p = sim.player.index;
  return { x: sim.ants.x[p]!, y: sim.ants.y[p]! };
};

describe('player ant', () => {
  it('exists in snapshots and is deterministic for a command sequence', () => {
    const go = () => {
      const sim = makeSim();
      run(sim, 30, [
        { type: 'playerMoveTo', x: 700, y: 300 },
        { type: 'playerToggleTrail', on: true },
        { type: 'playerRecruit', count: 5 },
      ]);
      run(sim, 100, [{ type: 'playerMoveDir', dx: -1, dy: 0.5 }]);
      return sim.snapshot({ pheromones: true });
    };
    const a = go();
    expect(a.player).not.toBeNull();
    expect(a.player!.recruits).toBe(5);
    expect(a).toEqual(go());
  });

  it('moveTo walks to the target and stops there', () => {
    const sim = makeSim();
    run(sim, 400, [{ type: 'playerMoveTo', x: 800, y: 200 }]);
    const p = pos(sim);
    expect(Math.hypot(p.x - 800, p.y - 200)).toBeLessThan(4);
    const before = pos(sim);
    run(sim, 20);
    expect(pos(sim)).toEqual(before);
  });

  it('moveDir moves continuously, stops at world edges, and stops on zero', () => {
    const sim = makeSim();
    run(sim, 20, [{ type: 'playerMoveDir', dx: 1, dy: 0 }]);
    const mid = pos(sim);
    expect(mid.x).toBeGreaterThan(NEST + 10);
    run(sim, 600);
    expect(pos(sim).x).toBe(WORLD);
    run(sim, 1, [{ type: 'playerMoveDir', dx: 0, dy: 0 }]);
    const stopped = pos(sim);
    run(sim, 10);
    expect(pos(sim)).toEqual(stopped);
  });

  it('is not driven by the normal ant AI', () => {
    const sim = makeSim();
    const before = pos(sim);
    run(sim, 50);
    expect(pos(sim)).toEqual(before);
  });

  it('recruits the nearest idle ants and they follow the player', () => {
    const sim = makeSim({ ants: 400 });
    const p0 = pos(sim);
    const dist = (i: number) => Math.hypot(sim.ants.x[i]! - p0.x, sim.ants.y[i]! - p0.y);
    const idle = [...Array(sim.ants.count).keys()]
      .filter((i) => i !== sim.player.index)
      .sort((a, b) => dist(a) - dist(b) || a - b);
    run(sim, 0, [{ type: 'playerRecruit', count: 5 }]);
    const snap = sim.snapshot();
    expect([...snap.player!.recruitedIndices].sort()).toEqual(idle.slice(0, 5).sort());
    for (const i of idle.slice(0, 5)) expect(sim.ants.state[i]).toBe(AntState.Recruited);

    run(sim, 300, [{ type: 'playerMoveTo', x: 850, y: 700 }]);
    const p = pos(sim);
    for (const i of idle.slice(0, 5)) {
      expect(Math.hypot(sim.ants.x[i]! - p.x, sim.ants.y[i]! - p.y)).toBeLessThan(60);
    }

    run(sim, 1, [{ type: 'playerRelease' }]);
    expect(sim.snapshot().player!.recruits).toBe(0);
    for (const i of idle.slice(0, 5)) expect(sim.ants.state[i]).not.toBe(AntState.Recruited);
  });

  it('recruits drop out and forage when they find food', () => {
    const sim = makeSim({ ants: 100 });
    run(sim, 0, [{ type: 'playerRecruit', count: 5 }]);
    expect(sim.player.recruitCount).toBe(5);
    const p = pos(sim);
    sim.applyCommands([{ type: 'placeFood', x: p.x + 20, y: p.y, amount: 500 }]);
    run(sim, 5);
    expect(sim.player.recruitCount).toBeLessThan(5);
  });

  it('laid trail is followed by ordinary ants', () => {
    const sim = makeSim({ ants: 1 });
    // Park a single ordinary ant just beside a freshly laid trail line, heading across it.
    run(sim, 0, [{ type: 'playerMoveTo', x: NEST, y: NEST }]);
    sim.applyCommands([{ type: 'spawnAnts', count: 1, x: 0, y: 0 }]);
    const player = sim.player.index;
    for (let x = 100; x <= 900; x += 4) sim.pheromones.deposit('food', x, 300, 0.6);
    const other = [...Array(sim.ants.count).keys()].find((i) => i !== player)!;
    sim.ants.x[other] = 500;
    sim.ants.y[other] = 280;
    sim.ants.heading[other] = Math.PI / 2; // towards the trail
    run(sim, 25);
    expect(sim.ants.state[other]).toBe(AntState.FollowTrail);
    expect(Math.abs(sim.ants.y[other] - 300)).toBeLessThan(25);
  });

  it('trail toggle deposits food pheromone while moving', () => {
    const sim = makeSim({ ants: 50 });
    run(sim, 0, [{ type: 'playerToggleTrail', on: true }]);
    const before = sim.pheromones.total('food');
    run(sim, 40, [{ type: 'playerMoveDir', dx: 1, dy: 0 }]);
    expect(sim.pheromones.total('food')).toBeGreaterThan(before + 1);
    expect(sim.snapshot().player!.trail).toBe(true);
    run(sim, 1, [{ type: 'playerToggleTrail', on: false }]);
    const off = sim.pheromones.total('food');
    run(sim, 10);
    expect(sim.pheromones.total('food')).toBeLessThan(off);
  });

  it('picks up from a pile, then drops into the colony store at the nest', () => {
    const sim = makeSim({ ants: 20 });
    const p = pos(sim);
    run(sim, 0, [{ type: 'placeFood', x: p.x + 60, y: p.y, amount: 100 }]);
    run(sim, 0, [{ type: 'playerPickupDrop' }]);
    expect(sim.ants.carrying[sim.player.index]).toBe(0); // too far away
    run(sim, 100, [{ type: 'playerMoveTo', x: p.x + 60, y: p.y }]);
    run(sim, 0, [{ type: 'playerPickupDrop' }]);
    expect(sim.ants.carrying[sim.player.index]).toBeGreaterThan(0);
    expect(sim.snapshot().player!.carrying).toBeGreaterThan(0);

    run(sim, 300, [{ type: 'playerMoveTo', x: NEST, y: NEST }]);
    const store = sim.world.nest.store;
    run(sim, 0, [{ type: 'playerPickupDrop' }]);
    expect(sim.world.nest.store).toBeGreaterThan(store);
    expect(sim.ants.carrying[sim.player.index]).toBe(0);
  });

  it('auto-swaps to the nearest ant and emits an event when the player vanishes', () => {
    const sim = makeSim({ ants: 50 });
    const old = sim.player.index;
    run(sim, 1);
    sim.snapshot(); // drain
    sim.ants.count = old; // player's slot disappears
    run(sim, 1);
    expect(sim.player.index).toBeGreaterThanOrEqual(0);
    expect(sim.player.index).toBeLessThan(sim.ants.count);
    const snap = sim.snapshot();
    expect(snap.events).toEqual([{ type: 'playerSwapped', from: old, to: sim.player.index }]);
    expect(sim.snapshot().events).toEqual([]);
  });

  it('survives clearAnts and respawn', () => {
    const sim = makeSim({ ants: 10 });
    run(sim, 1, [{ type: 'clearAnts' }]);
    expect(sim.snapshot().player).toBeNull();
    run(sim, 2, [{ type: 'spawnAnts', count: 5, x: 100, y: 100 }]);
    expect(sim.snapshot().player).not.toBeNull();
  });
});
