import type { Difficulty } from '@ant/shared';
import type { Rng } from '../rng';
import { patchDistance } from './layout';
import type { PatchDef } from './layout';

/** A colony collapsed to three numbers. */
export interface ColonySummary {
  /** Adult ants (breeders included). */
  pop: number;
  /** Breeders waiting for a mating flight (part of `pop`). */
  breeders: number;
  /** Food in the nest store. */
  food: number;
}

/** A patch's changing state (its static facts are in `PatchDef`). Plain data: it is saved. */
export interface PatchState {
  /** Natural food lying around. */
  food: number;
  /** null = no colony of that side here. */
  black: ColonySummary | null;
  red: ColonySummary | null;
}

export type Side = 'black' | 'red';
export const SIDES: readonly Side[] = ['black', 'red'];
/** Colony id of each side (as in the detailed sim and in events). */
export const SIDE_COLONY: Record<Side, number> = { black: 0, red: 1 };

/**
 * Abstract model tuning. One abstract tick covers `interval` sim ticks (5 s of game time); the
 * numbers are per abstract tick and roughly match what a colony of that size does in the
 * detailed sim, so collapsing and expanding a patch doesn't change its fortunes much.
 */
export const MODEL = {
  interval: 100,
  /** Abstract ticks per season; the seasonal mating flights happen when one starts. */
  seasonLength: 24,
  /** Food an ant brings home, at most (the patch's natural food runs out). */
  forage: 0.25,
  upkeepPerAnt: 0.02,
  queenUpkeep: 0.5,
  /** Fraction of the colony starving per abstract tick with an empty store. */
  starve: 0.05,
  eggCost: 1,
  /** Max new adults per abstract tick (one queen lays only so fast). */
  maxBirths: 6,
  /** Most ants of one colony a patch supports (logistic growth towards it). */
  capYard: 700,
  capRoom: 350,
  /** Each enemy ant kills this many of ours per abstract tick in a shared patch. */
  fight: 0.04,
  /** A colony this small has lost its queen's guard: it is wiped out. */
  minPop: 3,
  /** Fraction of the ants in a room stamped on per abstract tick (x pressure). */
  humans: 0.012,
  /** Mating flights: breeders fly this many patches (Chebyshev) at most, to up to `targets` patches. */
  flightRange: 2,
  flightTargets: 3,
  /** Total black breeders needed before the player can start a flight. */
  flightMin: 8,
  /** A colony takes part in a seasonal flight with at least this many breeders. */
  seasonalMin: 4,
  /** Per-breeder chance of founding a colony in an empty patch. */
  foundChance: 0.12,
  /** Founding chance multiplier when the other side already has a colony there. */
  contested: 0.35,
  /** Founding chance multiplier in a house room. */
  indoors: 0.6,
  /** A new colony: `foundPop + foundPerBreeder x breeders` ants and `foundFood` food. */
  foundPop: 10,
  foundPerBreeder: 2,
  foundFood: 40,
  /** Breeders landing on a patch their own side already holds join that colony at this rate. */
  joinRate: 0.5,
  /** Infestation meter: abstract ticks above target to fill it (from empty), and to drain it. */
  meterFill: 24,
  meterDrain: 48,
};

interface SideProfile {
  /** Birth-rate multiplier. */
  growth: number;
  /** Fraction of births that become breeders (black: from the player's caste ratio). */
  breeders: number;
  /** Founding chance multiplier. */
  found: number;
  /** Combat strength multiplier. */
  strength: number;
}

/** Red's strength by difficulty; black's founding luck and the humans' patience too. */
export const CAMPAIGN_DIFFICULTY: Record<
  Difficulty,
  { red: SideProfile; blackFound: number; humans: number; indoorTarget: number }
> = {
  easy: {
    red: { growth: 0.7, breeders: 0.06, found: 0.6, strength: 0.8 },
    blackFound: 1.3,
    humans: 0.7,
    indoorTarget: 220,
  },
  normal: {
    red: { growth: 1, breeders: 0.09, found: 0.9, strength: 1 },
    blackFound: 1,
    humans: 1,
    indoorTarget: 350,
  },
  hard: {
    red: { growth: 1.25, breeders: 0.12, found: 1.2, strength: 1.25 },
    blackFound: 0.8,
    humans: 1.3,
    indoorTarget: 500,
  },
};

export interface ModelContext {
  defs: readonly PatchDef[];
  patches: PatchState[];
  difficulty: Difficulty;
  /** Share of black births that are breeders (the player's caste ratio). */
  blackBreederShare: number;
  /** The patch simulated in detail: skipped here (the sim owns it). */
  active: number;
  /** Black ants in the house right now (pressure on the humans). */
  indoor: number;
  /** Colonies that died this tick, reported to the caller. */
  destroyed: { side: Side; patch: number }[];
}

function profile(ctx: ModelContext, side: Side): SideProfile {
  const d = CAMPAIGN_DIFFICULTY[ctx.difficulty];
  return side === 'red'
    ? d.red
    : { growth: 1, breeders: ctx.blackBreederShare, found: d.blackFound, strength: 1 };
}

/**
 * Advance every summarised patch by one abstract tick: food regrows, colonies forage, eat,
 * starve, breed (some births become breeders), fight a rival colony in the same patch, and
 * get stamped on indoors. Uses no randomness, so it is deterministic and order-independent
 * between patches. Cost: a few dozen flops per patch.
 */
export function abstractTick(ctx: ModelContext): void {
  const { defs, patches } = ctx;
  const diff = CAMPAIGN_DIFFICULTY[ctx.difficulty];
  const pressure = 1 + Math.min(2, ctx.indoor / diff.indoorTarget);
  for (let id = 0; id < patches.length; id++) {
    if (id === ctx.active) continue;
    const def = defs[id]!;
    const p = patches[id]!;
    p.food = Math.min(def.foodCap, p.food + def.foodRegen);
    const cap = def.kind === 'room' ? MODEL.capRoom : MODEL.capYard;
    const total = (p.black?.pop ?? 0) + (p.red?.pop ?? 0);
    // Forage first, shared by head count, so neither side is favoured by update order.
    const want = total * MODEL.forage;
    const share = want > 0 ? Math.min(1, p.food / want) : 0;
    for (const side of SIDES) {
      const c = p[side];
      if (!c) continue;
      const got = c.pop * MODEL.forage * share;
      c.food += got;
      const prof = profile(ctx, side);
      c.food -= c.pop * MODEL.upkeepPerAnt + MODEL.queenUpkeep;
      if (c.food < 0) {
        c.food = 0;
        c.pop -= Math.ceil(c.pop * MODEL.starve);
      } else {
        const room = Math.max(0, 1 - c.pop / cap);
        const births = Math.min(c.food / MODEL.eggCost, MODEL.maxBirths * prof.growth * room);
        c.food -= births * MODEL.eggCost;
        c.pop += births;
        c.breeders += births * prof.breeders;
      }
    }
    p.food = Math.max(0, p.food - want * share);
    if (p.black && p.red) {
      const blackLoss = p.red.pop * MODEL.fight * profile(ctx, 'red').strength;
      const redLoss = p.black.pop * MODEL.fight;
      p.black.pop -= blackLoss;
      p.red.pop -= redLoss;
    }
    if (def.kind === 'room') {
      for (const side of SIDES) {
        const c = p[side];
        if (c) c.pop -= c.pop * MODEL.humans * diff.humans * pressure;
      }
    }
    for (const side of SIDES) {
      const c = p[side];
      if (!c) continue;
      if (c.pop < MODEL.minPop) {
        p[side] = null;
        ctx.destroyed.push({ side, patch: id });
        continue;
      }
      c.breeders = Math.min(Math.max(0, c.breeders), c.pop * 0.3);
    }
  }
}

/** Where one source colony's breeders went. */
export interface FlightResult {
  breeders: number;
  founded: number[];
}

/**
 * A mating flight of `side` from patch `from` with `breeders` breeders (the caller has already
 * taken them out of the source colony). They scatter to up to `flightTargets` patches within
 * `flightRange`, preferring empty, near patches. In each target they found a colony with
 * chance `1 - (1 - q)^n` (q lower when the other side is there, and indoors), or join their
 * own side's colony. The patch in `exclude` (the detailed one) is never a target.
 */
export function fly(
  ctx: ModelContext,
  rng: Rng,
  side: Side,
  from: number,
  breeders: number,
  exclude: number,
): FlightResult {
  const result: FlightResult = { breeders, founded: [] };
  if (breeders < 1) return result;
  const { defs, patches } = ctx;
  const src = defs[from]!;
  const other: Side = side === 'black' ? 'red' : 'black';
  const candidates: { id: number; w: number }[] = [];
  for (const def of defs) {
    if (def.id === from || def.id === exclude) continue;
    const d = patchDistance(src, def);
    if (d > MODEL.flightRange) continue;
    const p = patches[def.id]!;
    const w = (p[side] ? 0.3 : p[other] ? 0.6 : 1) / d;
    candidates.push({ id: def.id, w });
  }
  const picks: number[] = [];
  while (picks.length < MODEL.flightTargets && candidates.length) {
    let sum = 0;
    for (const c of candidates) sum += c.w;
    let r = rng.next() * sum;
    let k = 0;
    while (k < candidates.length - 1 && (r -= candidates[k]!.w) > 0) k++;
    picks.push(candidates[k]!.id);
    candidates.splice(k, 1);
  }
  if (!picks.length) return result;
  const prof = profile(ctx, side);
  const each = Math.floor(breeders / picks.length);
  let extra = breeders - each * picks.length;
  for (const id of picks) {
    const n = each + (extra-- > 0 ? 1 : 0);
    if (n <= 0) continue;
    const p = patches[id]!;
    const own = p[side];
    if (own) {
      own.pop += n * MODEL.joinRate;
      continue;
    }
    let q = MODEL.foundChance * prof.found;
    if (p[other]) q *= MODEL.contested;
    if (defs[id]!.kind === 'room') q *= MODEL.indoors;
    const chance = 1 - Math.pow(1 - Math.min(0.95, q), n);
    if (rng.next() < chance) {
      p[side] = {
        pop: MODEL.foundPop + n * MODEL.foundPerBreeder,
        breeders: 0,
        food: MODEL.foundFood,
      };
      result.founded.push(id);
    }
  }
  return result;
}
