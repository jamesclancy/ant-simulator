import { describe, expect, it } from 'vitest';
import { Caste, PLAYER_COLONY } from '@ant/shared';
import type { SimEvent } from '@ant/shared';
import { Campaign, isCampaignSave, readSaveInfo, restoreCampaign } from '../src';
import { MODEL, START_PATCH, YARD_COLS, abstractTick, buildLayout, fly } from '../src/campaign';
import type { ModelContext, PatchState } from '../src/campaign';
import { createRng } from '../src/rng';

const ROOM_IDS = [48, 49, 50, 51, 52, 53];
/** A yard patch two to the right of the start: inside flight range, not a starting red patch. */
const NEAR = START_PATCH + 2;

function stepN(c: Campaign, n: number, events?: SimEvent[]): void {
  for (let i = 0; i < n; i++) {
    c.step();
    if (events) events.push(...c.snapshot().events);
  }
}

function freshPatches(n: number): PatchState[] {
  return Array.from({ length: n }, () => ({ food: 2000, black: null, red: null }));
}

describe('campaign layout', () => {
  it('has an 8x6 yard plus six house rooms bordering its top row', () => {
    const defs = buildLayout(7);
    expect(defs).toHaveLength(54);
    expect(defs.filter((d) => d.kind === 'yard')).toHaveLength(48);
    const rooms = defs.filter((d) => d.kind === 'room');
    expect(rooms.map((r) => r.id)).toEqual(ROOM_IDS);
    expect(rooms.find((r) => r.name === 'Kitchen')!.row).toBe(-1);
    expect(buildLayout(7)).toEqual(defs);
  });
});

describe('abstract model', () => {
  const ctx = (patches: PatchState[]): ModelContext => ({
    defs: buildLayout(3),
    patches,
    difficulty: 'normal',
    blackBreederShare: 0.12,
    active: -1,
    indoor: 0,
    destroyed: [],
  });

  it('is deterministic and grows a lone colony that raises breeders', () => {
    const run = (): PatchState[] => {
      const patches = freshPatches(54);
      patches[10]!.black = { pop: 50, breeders: 0, food: 30 };
      patches[20]!.red = { pop: 50, breeders: 0, food: 30 };
      for (let i = 0; i < 40; i++) abstractTick(ctx(patches));
      return patches;
    };
    const a = run();
    expect(run()).toEqual(a);
    expect(a[10]!.black!.pop).toBeGreaterThan(100);
    expect(a[10]!.black!.breeders).toBeGreaterThan(5);
    expect(a[20]!.red!.breeders).toBeGreaterThan(3);
  });

  it('makes rivals in one patch fight until one dies out', () => {
    const patches = freshPatches(54);
    patches[5]!.black = { pop: 300, breeders: 0, food: 100 };
    patches[5]!.red = { pop: 60, breeders: 0, food: 100 };
    const c = ctx(patches);
    for (let i = 0; i < 60 && patches[5]!.red; i++) abstractTick(c);
    expect(patches[5]!.red).toBeNull();
    expect(patches[5]!.black.pop).toBeGreaterThan(100);
    expect(c.destroyed).toContainEqual({ side: 'red', patch: 5 });
  });

  it('leaves the active patch alone', () => {
    const patches = freshPatches(54);
    patches[5]!.black = { pop: 100, breeders: 0, food: 100 };
    const before = structuredClone(patches[5]);
    abstractTick({ ...ctx(patches), active: 5 });
    expect(patches[5]).toEqual(before);
  });

  it('mating flights found colonies near the source, never in the excluded patch', () => {
    const patches = freshPatches(54);
    const c = ctx(patches);
    const r = fly(c, createRng(1), 'black', 9, 60, 10);
    expect(r.founded.length).toBeGreaterThan(0);
    for (const id of r.founded) {
      expect(id).not.toBe(10);
      expect(patches[id]!.black).not.toBeNull();
      const d = c.defs[id]!;
      expect(Math.max(Math.abs(d.col - 1), Math.abs(d.row - 1))).toBeLessThanOrEqual(
        MODEL.flightRange,
      );
    }
  });
});

describe('Campaign', () => {
  it('starts with black in the start patch (detailed) and two red colonies', () => {
    const c = new Campaign({ seed: 5, difficulty: 'normal' });
    expect(c.active).toBe(START_PATCH);
    expect(c.owned('black')).toBe(1);
    expect(c.owned('red')).toBe(2);
    expect(c.sim.colonies).toHaveLength(1);
    expect(c.sim.colonies[0]!.population).toBe(120);
    const info = c.info();
    expect(info.patches).toHaveLength(54);
    expect(info.owned).toBe(1);
    expect(info.outcome).toBe('');
  });

  it('is deterministic tick for tick', () => {
    const a = new Campaign({ seed: 11, difficulty: 'hard' });
    const b = new Campaign({ seed: 11, difficulty: 'hard' });
    stepN(a, 450);
    stepN(b, 450);
    expect(b.getState()).toEqual(a.getState());
    expect(b.sim.getState()).toEqual(a.sim.getState());
  });

  it('a mating flight takes the breeder ants out of the detailed patch and founds colonies', () => {
    const c = new Campaign({ seed: 2, difficulty: 'normal' });
    const nest = c.sim.colonies[0]!.nest;
    c.sim.applyCommands([
      { type: 'spawnAnts', count: 40, x: nest.x, y: nest.y, colony: 0, caste: Caste.Breeder },
    ]);
    c.step();
    expect(c.blackBreeders()).toBe(40);
    const antsBefore = c.sim.ants.count;
    const founded = c.matingFlight();
    expect(founded).not.toBeNull();
    expect(founded!.length).toBeGreaterThan(0);
    expect(c.sim.colonies[0]!.castes[Caste.Breeder]).toBe(0);
    expect(c.sim.ants.count).toBe(antsBefore - 40);
    expect(c.owned('black')).toBe(1 + founded!.length);
    const events = c.snapshot().events;
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'matingFlight', colony: 0, breeders: 40 }),
    );
    expect(events.filter((e) => e.type === 'colonyFounded')).toHaveLength(founded!.length);
    // The player ant survives the flight and the sim keeps stepping.
    stepN(c, 20);
    expect(c.sim.player.index).toBeGreaterThanOrEqual(0);
  });

  it('refuses a flight without enough breeders', () => {
    const c = new Campaign({ seed: 2, difficulty: 'normal' });
    expect(c.matingFlight()).toBeNull();
  });

  it('entering and leaving a patch preserves its summary', () => {
    const c = new Campaign({ seed: 9, difficulty: 'normal' });
    stepN(c, 50);
    const st = c.getState();
    st.patches[NEAR]!.black = { pop: 37, breeders: 4, food: 55.5 };
    st.patches[NEAR]!.red = { pop: 21, breeders: 2, food: 12 };
    c.setState(st);
    const others = c.getState().patches.filter((_, i) => i !== NEAR && i !== START_PATCH);

    expect(c.enter(NEAR)).toBe(true);
    expect(c.active).toBe(NEAR);
    const [black, red] = c.sim.colonies;
    expect(black!.population).toBe(37);
    expect(black!.castes[Caste.Breeder]).toBe(4);
    expect(black!.nest.store).toBe(55.5);
    expect(red!.population).toBe(21);
    expect(red!.nest.store).toBe(12);
    // The start patch was collapsed with what its detailed sim held.
    const start = c.patches[START_PATCH]!.black!;
    expect(start.pop).toBeGreaterThan(100);
    // Straight back out: the patch summary is unchanged, so is every other patch.
    expect(c.enter(START_PATCH)).toBe(true);
    const near = c.patches[NEAR]!;
    expect(near.black).toEqual({ pop: 37, breeders: 4, food: 55.5 });
    expect(near.red).toMatchObject({ pop: 21, food: 12 });
    expect(c.getState().patches.filter((_, i) => i !== NEAR && i !== START_PATCH)).toEqual(others);
    expect(c.sim.colonies[0]!.population).toBe(Math.round(start.pop));
  });

  it('only enters patches with a black colony', () => {
    const c = new Campaign({ seed: 9, difficulty: 'normal' });
    expect(c.enter(NEAR)).toBe(false);
    expect(c.enter(START_PATCH)).toBe(false);
    expect(c.active).toBe(START_PATCH);
  });

  it('switching patches is fast', () => {
    const c = new Campaign({ seed: 4, difficulty: 'normal' });
    const st = c.getState();
    st.patches[NEAR]!.black = { pop: 600, breeders: 20, food: 300 };
    st.patches[NEAR]!.red = { pop: 600, breeders: 0, food: 300 };
    c.setState(st);
    const t0 = performance.now();
    c.enter(NEAR);
    c.enter(START_PATCH);
    expect((performance.now() - t0) / 2).toBeLessThan(250);
  });

  it('wins when the house is infested long enough', () => {
    const c = new Campaign({ seed: 3, difficulty: 'easy' });
    const st = c.getState();
    for (const id of ROOM_IDS) st.patches[id]!.black = { pop: 340, breeders: 0, food: 500 };
    c.setState(st);
    const events: SimEvent[] = [];
    for (let i = 0; i < 40 && !c.over; i++) stepN(c, MODEL.interval, events);
    expect(c.outcome).toBe('victory');
    expect(c.meter).toBe(1);
    expect(events).toContainEqual({ type: 'campaignOver', won: true, reason: 'humansLeft' });
    // The game stops.
    const tick = c.tick;
    c.step();
    expect(c.tick).toBe(tick);
  });

  it('loses when the last black colony is destroyed', () => {
    const c = new Campaign({ seed: 3, difficulty: 'normal' });
    c.sim.colonies[PLAYER_COLONY]!.killQueen('combat');
    const events: SimEvent[] = [];
    stepN(c, MODEL.interval, events);
    expect(c.outcome).toBe('defeat');
    expect(events).toContainEqual({ type: 'colonyDestroyed', colony: 0, patch: START_PATCH });
    expect(events).toContainEqual({ type: 'campaignOver', won: false, reason: 'lastColony' });
  });

  it('house rooms have human feet that stamp on ants', () => {
    const c = new Campaign({ seed: 6, difficulty: 'hard' });
    const st = c.getState();
    const kitchen = ROOM_IDS[0]!;
    st.patches[kitchen]!.black = { pop: 300, breeders: 0, food: 200 };
    c.setState(st);
    expect(c.enter(kitchen)).toBe(true);
    expect(c.sim.config.rain.enabled).toBe(false);
    const events: SimEvent[] = [];
    stepN(c, 3000, events);
    expect(events.some((e) => e.type === 'footstepWarning')).toBe(true);
    const kills = events.reduce((n, e) => n + (e.type === 'footstep' ? e.kills : 0), 0);
    expect(kills).toBeGreaterThan(0);
  });

  it('red colonies expand on their own with the seasons', () => {
    const c = new Campaign({ seed: 8, difficulty: 'hard' });
    const events: SimEvent[] = [];
    stepN(c, MODEL.interval * MODEL.seasonLength * 2 + 1, events);
    expect(events.filter((e) => e.type === 'season')).toHaveLength(2);
    expect(c.owned('red')).toBeGreaterThan(2);
  });

  it('round-trips a save taken after a flight and a patch switch', () => {
    const c = new Campaign({ seed: 13, difficulty: 'normal' });
    stepN(c, 120);
    const nest = c.sim.colonies[0]!.nest;
    c.sim.applyCommands([
      { type: 'spawnAnts', count: 30, x: nest.x, y: nest.y, colony: 0, caste: Caste.Breeder },
    ]);
    c.step();
    const founded = c.matingFlight()!;
    expect(founded.length).toBeGreaterThan(0);
    stepN(c, 80);
    expect(c.enter(founded[0]!)).toBe(true);
    stepN(c, 130);

    const bytes = c.serialize();
    expect(isCampaignSave(bytes)).toBe(true);
    expect(readSaveInfo(bytes).campaign).toEqual({
      owned: c.owned('black'),
      patches: 54,
      difficulty: 'normal',
    });
    const r = restoreCampaign(bytes);
    expect(r.active).toBe(founded[0]);
    expect(r.getState()).toEqual(c.getState());
    expect(r.sim.getState()).toEqual(c.sim.getState());
    expect(r.info()).toEqual(c.info());
    // And they stay in lock-step, including the next abstract ticks and a switch back.
    stepN(c, 250);
    stepN(r, 250);
    expect(r.getState()).toEqual(c.getState());
    c.enter(START_PATCH);
    r.enter(START_PATCH);
    stepN(c, 50);
    stepN(r, 50);
    expect(r.sim.getState()).toEqual(c.sim.getState());
    expect(r.getState()).toEqual(c.getState());
  });

  it('keeps the yard grid shape in the overview', () => {
    const info = new Campaign({ seed: 1, difficulty: 'normal' }).info();
    expect(info.cols).toBe(YARD_COLS);
    expect(info.patches[START_PATCH]).toMatchObject({ kind: 'yard', black: 120 });
  });
});
