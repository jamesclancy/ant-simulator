import { describe, expect, it } from 'vitest';
import {
  ANT_FLAGS_OFFSET,
  ANT_STRIDE,
  AntState,
  Caste,
  flagCaste,
  flagColony,
  undergroundLayer,
} from '@ant/shared';
import type { Command, SimConfigInput, SimEvent } from '@ant/shared';
import { createSim } from '../src';

/** No economy: nothing hatches, eats or starves, everyone forages. */
const FROZEN = {
  maxLayRate: 0,
  upkeepPerAnt: 0,
  queenUpkeep: 0,
  behaviorRatio: { forage: 1, dig: 0, nurse: 0 },
};

function arena(extra: SimConfigInput = {}) {
  return createSim({
    spiders: 0,
    seed: 5,
    worldSize: 1024,
    initialAnts: 0,
    foodSources: 0,
    colony: FROZEN,
    ...extra,
  });
}

function count(sim: ReturnType<typeof arena>, colony: number, caste?: number): number {
  let n = 0;
  for (let i = 0; i < sim.ants.count; i++) {
    if (sim.ants.colony[i] === colony && (caste === undefined || sim.ants.caste[i] === caste)) n++;
  }
  return n;
}

const groundFood = (sim: ReturnType<typeof arena>) =>
  [...sim.world.food.list()].reduce((s, f) => s + f.amount, 0);

describe('two colonies', () => {
  it('places nests apart with point-symmetric food and spawns each colony at home', () => {
    const sim = createSim({ spiders: 0, seed: 9, initialAnts: 50 });
    const [black, red] = sim.world.nests;
    const size = sim.config.worldSize;
    expect(Math.hypot(black!.x - red!.x, black!.y - red!.y)).toBeGreaterThan(size * 0.5);
    const piles = [...sim.world.food.list()];
    expect(piles).toHaveLength(5);
    for (const p of piles) {
      // Every pile has a mirror image through the world centre (the odd one is the centre).
      const mirror = piles.find(
        (q) => Math.abs(q.x + p.x - size) < 1e-3 && Math.abs(q.y + p.y - size) < 1e-3,
      );
      expect(mirror).toBeDefined();
    }
    expect(count(sim, 0)).toBe(50);
    expect(count(sim, 1)).toBe(50);
    for (let i = 0; i < sim.ants.count; i++) {
      const nest = sim.world.nests[sim.ants.colony[i]!]!;
      expect(Math.hypot(sim.ants.x[i]! - nest.x, sim.ants.y[i]! - nest.y)).toBeLessThan(200);
    }
  });

  it('is deterministic with two colonies, combat and the AI director', () => {
    const go = () => {
      const sim = createSim({ spiders: 0, seed: 21, worldSize: 1024, initialAnts: 150 });
      const mid = 512;
      const cmds: Record<number, Command[]> = {
        50: [
          { type: 'spawnAnts', count: 30, x: mid, y: mid, colony: 0, caste: Caste.Soldier },
          { type: 'spawnAnts', count: 30, x: mid, y: mid + 10, colony: 1, caste: Caste.Soldier },
        ],
        200: [{ type: 'setRaid', colony: 0, on: true }],
      };
      for (let t = 0; t < 1500; t++) {
        const c = cmds[t];
        if (c) sim.applyCommands(c);
        sim.step();
      }
      return sim.snapshot({ pheromones: true, nestGrid: true });
    };
    const a = go();
    expect(a.colonies[0]!.losses + a.colonies[1]!.losses).toBeGreaterThan(10);
    expect(go()).toEqual(a);
  });

  it('isolates trails: red ants ignore a black food trail that black ants follow', () => {
    const followers = (colony: number) => {
      const sim = arena();
      // A strong black trail across the middle of the map, refreshed every tick.
      const trail: Command[] = [];
      for (let x = 300; x <= 700; x += 4) {
        trail.push({
          type: 'depositPheromone',
          pheromone: 'food',
          x,
          y: 512,
          amount: 1,
          colony: 0,
        });
      }
      sim.applyCommands([...trail, { type: 'spawnAnts', count: 40, x: 500, y: 530, colony }]);
      let following = 0;
      for (let t = 0; t < 60; t++) {
        sim.applyCommands(trail);
        sim.step();
        for (let i = 0; i < sim.ants.count; i++) {
          if (sim.ants.colony[i] === colony && sim.ants.state[i] === AntState.FollowTrail)
            following++;
        }
      }
      return following;
    };
    expect(followers(1)).toBe(0);
    expect(followers(0)).toBeGreaterThan(200);
  });
});

describe('combat', () => {
  const battle = () => {
    const sim = arena();
    sim.applyCommands([
      { type: 'spawnAnts', count: 50, x: 500, y: 500, colony: 0, caste: Caste.Soldier },
      { type: 'spawnAnts', count: 50, x: 520, y: 500, colony: 1, caste: Caste.Worker },
    ]);
    return sim;
  };

  it('resolves: 50 soldiers beat 50 workers', () => {
    const sim = battle();
    let sawFight = false;
    for (let t = 0; t < 400; t++) {
      sim.step();
      sawFight ||= sim.colonies[0]!.fighting > 0;
    }
    expect(sawFight).toBe(true);
    // The fight is over; at most a straggler or two got away.
    expect(sim.colonies[0]!.fighting + sim.colonies[1]!.fighting).toBe(0);
    expect(sim.colonies[1]!.losses).toBeGreaterThanOrEqual(48);
    expect(count(sim, 0, Caste.Soldier)).toBeGreaterThan(40);
  });

  it('turns the dead into food on the ground', () => {
    const sim = battle();
    expect(groundFood(sim)).toBe(0);
    for (let t = 0; t < 400; t++) sim.step();
    const dead = sim.colonies[0]!.losses + sim.colonies[1]!.losses;
    expect(dead).toBeGreaterThanOrEqual(50);
    expect(groundFood(sim)).toBeCloseTo(dead * sim.config.combat.corpseFood);
    // Corpse food is merged into a handful of piles, not one per ant.
    expect(sim.world.food.size).toBeLessThan(dead / 2);
  });

  it('lays alarm that pulls in nearby idle workers of the same colony', () => {
    const sim = arena({ worldSize: 2048 });
    // A standing fight at (1000, 1000) and idle black workers 70-110 units away.
    sim.applyCommands([
      { type: 'spawnAnts', count: 12, x: 1000, y: 1000, colony: 0, caste: Caste.Soldier },
      { type: 'spawnAnts', count: 12, x: 1005, y: 1000, colony: 1, caste: Caste.Soldier },
      { type: 'spawnAnts', count: 30, x: 1090, y: 1000, colony: 0, caste: Caste.Worker },
    ]);
    const meanDist = () => {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < sim.ants.count; i++) {
        if (sim.ants.colony[i] !== 0 || sim.ants.caste[i] !== Caste.Worker) continue;
        sum += Math.hypot(sim.ants.x[i]! - 1000, sim.ants.y[i]! - 1000);
        n++;
      }
      return sum / n;
    };
    const before = meanDist();
    let closest = before;
    let mostFighting = 0;
    for (let t = 0; t < 80; t++) {
      sim.step();
      closest = Math.min(closest, meanDist());
      mostFighting = Math.max(mostFighting, sim.colonies[0]!.fighting);
    }
    expect(sim.pheromones.total('alarm')).toBeGreaterThan(0);
    expect(sim.fields[1]!.total('alarm')).toBeGreaterThan(0);
    // Workers converge on the fight and join in (more black fighters than the 12 soldiers);
    // afterwards they carry the corpse food home.
    expect(closest).toBeLessThan(before * 0.8);
    expect(mostFighting).toBeGreaterThan(16);
  });

  it('marks colony and caste in the snapshot', () => {
    const sim = arena();
    sim.applyCommands([
      { type: 'spawnAnts', count: 1, x: 100, y: 100, colony: 1, caste: Caste.Soldier },
      { type: 'spawnAnts', count: 1, x: 900, y: 900, colony: 0, caste: Caste.Worker },
    ]);
    const snap = sim.snapshot();
    const flags = (i: number) => snap.ants[i * ANT_STRIDE + ANT_FLAGS_OFFSET]!;
    expect([flagColony(flags(0)), flagCaste(flags(0))]).toEqual([1, Caste.Soldier]);
    expect([flagColony(flags(1)), flagCaste(flags(1))]).toEqual([0, Caste.Worker]);
  });

  it('swaps the player to another black ant when the player is killed', () => {
    const sim = arena();
    // Two black groups far apart: whichever holds the player, the other takes over.
    sim.applyCommands([
      { type: 'spawnAnts', count: 5, x: 150, y: 150, colony: 0, caste: Caste.Worker },
      { type: 'spawnAnts', count: 5, x: 870, y: 870, colony: 0, caste: Caste.Worker },
    ]);
    sim.step();
    const p = sim.player.index;
    expect(p).toBeGreaterThanOrEqual(0);
    const at = { x: sim.ants.x[p]!, y: sim.ants.y[p]! };
    sim.applyCommands([
      { type: 'spawnAnts', count: 40, x: at.x, y: at.y, colony: 1, caste: Caste.Soldier },
    ]);
    const events: SimEvent[] = [];
    for (let t = 0; t < 600 && !events.some((e) => e.type === 'playerSwapped'); t++) {
      sim.step();
      events.push(...sim.snapshot().events);
    }
    expect(events.some((e) => e.type === 'playerSwapped')).toBe(true);
    const q = sim.player.index;
    expect(q).toBeGreaterThanOrEqual(0);
    expect(sim.ants.colony[q]).toBe(0);
  });
});

describe('raids and game over', () => {
  it('soldiers raid the enemy nest; killing the queen ends the game', () => {
    const sim = arena({ colonies: 2 });
    const red = sim.world.nests[1]!;
    sim.applyCommands([
      { type: 'spawnAnts', count: 60, x: red.x + 80, y: red.y, colony: 0, caste: Caste.Soldier },
      { type: 'setRaid', colony: 0, on: true },
    ]);
    const events: SimEvent[] = [];
    let sawRaider = false;
    for (let t = 0; t < 4000 && sim.winner === -1; t++) {
      sim.step();
      events.push(...sim.snapshot().events);
      for (let i = 0; i < sim.ants.count && !sawRaider; i++) {
        sawRaider = sim.ants.colony[i] === 0 && sim.ants.layer[i] === undergroundLayer(1);
      }
    }
    expect(sawRaider).toBe(true);
    expect(sim.colonies[1]!.queenAlive).toBe(false);
    expect(sim.winner).toBe(0);
    expect(events).toContainEqual({ type: 'queenKilled', colony: 1, cause: 'combat' });
    expect(events).toContainEqual({ type: 'gameOver', winner: 0 });
    expect(sim.snapshot().winner).toBe(0);
    expect(sim.snapshot().colonies[1]!.lost).toBe(true);
  });

  it('a starved player queen is a defeat', () => {
    const sim = arena({
      colony: { ...FROZEN, startFood: 0, queenUpkeep: 0.01, queenStarveTicks: 50 },
    });
    for (let t = 0; t < 200 && sim.winner === -1; t++) sim.step();
    // Both queens starve on the same tick here: nobody wins.
    expect(sim.winner).toBe(-2);
  });
});

describe('AI director', () => {
  it('raises the soldier share under threat and does not raid while threatened', () => {
    const sim = createSim({
      spiders: 0,
      seed: 3,
      initialAnts: 100,
      foodSources: 0,
      colony: { upkeepPerAnt: 0, queenUpkeep: 0, startFood: 200 },
    });
    const director = sim.directors[0]!;
    const red = sim.colonies[1]!;
    for (let t = 0; t <= director.profile.interval; t++) sim.step();
    const calm = red.casteRatio.soldier;
    expect(director.state!.threat).toBe(0);

    const nest = sim.world.nests[1]!;
    sim.applyCommands([
      { type: 'spawnAnts', count: 80, x: nest.x + 150, y: nest.y, colony: 0, caste: Caste.Soldier },
    ]);
    for (let t = 0; t < director.profile.interval; t++) sim.step();
    expect(director.state!.threat).toBeGreaterThan(0.5);
    expect(red.casteRatio.soldier).toBeGreaterThan(calm + 0.15);
    expect(red.raid).toBe(false);
    // New adults follow the ratio: soldiers now hatch.
    expect(red.nextCaste()).toBe(Caste.Soldier);
  });

  it('is stronger on hard than on easy', () => {
    const easy = createSim({ spiders: 0, difficulty: 'easy' });
    const hard = createSim({ spiders: 0, difficulty: 'hard' });
    expect(hard.colonies[1]!.config.maxLayRate).toBeGreaterThan(
      easy.colonies[1]!.config.maxLayRate,
    );
    expect(hard.directors[0]!.profile.interval).toBeLessThan(easy.directors[0]!.profile.interval);
  });
});
