import type { BehaviorRatio, CasteRatio, Difficulty } from '@ant/shared';
import type { Colony } from '../colony/colony';

/** Per-difficulty knobs for the AI colony. */
export interface DirectorProfile {
  /** Ticks between decisions. */
  interval: number;
  /** Multiplier on the AI colony's `maxLayRate` (applied once at setup). */
  layRateMult: number;
  /** Extra starting food for the AI colony. */
  startFoodBonus: number;
  /** Soldier share with no threat or opportunity, and its ceiling. */
  soldierBase: number;
  soldierMax: number;
  /** Start a raid once our fighting strength is this many times the enemy's... */
  raidStrength: number;
  /** ...and we have at least this many soldiers. */
  raidMinSoldiers: number;
  /** No raids before this tick (time for the player to get going). */
  graceTicks: number;
}

export const DIRECTOR_PROFILES: Record<Difficulty, DirectorProfile> = {
  easy: {
    interval: 200,
    layRateMult: 0.75,
    startFoodBonus: 0,
    soldierBase: 0.08,
    soldierMax: 0.35,
    raidStrength: 2,
    raidMinSoldiers: 150,
    graceTicks: 6000,
  },
  normal: {
    interval: 120,
    layRateMult: 1,
    startFoodBonus: 0,
    soldierBase: 0.15,
    soldierMax: 0.5,
    raidStrength: 1.4,
    raidMinSoldiers: 80,
    graceTicks: 3600,
  },
  hard: {
    interval: 60,
    layRateMult: 1.3,
    startFoodBonus: 30,
    soldierBase: 0.2,
    soldierMax: 0.6,
    raidStrength: 1.1,
    raidMinSoldiers: 50,
    graceTicks: 1800,
  },
};

/** Rough fighting value of a soldier relative to a worker (HP x damage). */
const SOLDIER_POWER = 5;

/** What the director last saw and decided (for tests, the debug panel and tuning). */
export interface DirectorState {
  threat: number;
  hunger: number;
  opportunity: number;
  strength: number;
  caste: CasteRatio;
  behavior: BehaviorRatio;
  raid: boolean;
}

export interface DirectorSaveState {
  lastLosses: number;
  threatAvg: number;
  state: DirectorState | null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Utility-based director for an AI colony (PLAN section 3). Every `interval` ticks it scores
 * a few needs from the colony's census and economy, and sets the colony's caste ratio,
 * behaviour ratio and raid flag from them. Pure arithmetic over sim state, so it is
 * deterministic and costs nothing between decisions.
 *
 * - threat: enemy ants near the entrance, intruders in the nest, and recent losses
 *   (smoothed so one skirmish does not flip the whole colony).
 * - hunger: how far the store is below a comfortable level.
 * - opportunity: our fighting strength (workers + weighted soldiers) over the enemy's.
 *
 * Soldier share rises with threat and opportunity and falls with hunger; foraging rises
 * with hunger; nursing follows the brood; digging follows the lack of nursery room. A raid
 * starts when strength and soldier count clear the difficulty's bar and nothing threatens
 * home, and continues (hysteresis) until the soldiers are spent or home is threatened.
 */
export class Director {
  readonly profile: DirectorProfile;
  private lastLosses = 0;
  private threatAvg = 0;
  state: DirectorState | null = null;

  constructor(
    readonly colony: Colony,
    private readonly colonies: readonly Colony[],
    difficulty: Difficulty,
  ) {
    this.profile = DIRECTOR_PROFILES[difficulty];
  }

  getState(): DirectorSaveState {
    return {
      lastLosses: this.lastLosses,
      threatAvg: this.threatAvg,
      state: this.state && {
        ...this.state,
        caste: { ...this.state.caste },
        behavior: { ...this.state.behavior },
      },
    };
  }

  setState(s: DirectorSaveState): void {
    this.lastLosses = s.lastLosses;
    this.threatAvg = s.threatAvg;
    this.state = s.state;
  }

  update(tick: number): void {
    if (tick % this.profile.interval === 0) this.decide(tick);
  }

  decide(tick: number): void {
    const me = this.colony;
    if (!me.queenAlive) return;
    const p = this.profile;
    const foe = this.colonies.find((c) => c !== me && c.queenAlive);
    const pop = Math.max(1, me.population);

    const losses = me.losses - this.lastLosses;
    this.lastLosses = me.losses;
    const now = clamp01(me.threat / 30 + me.intruders / 5 + (losses / pop) * 10);
    this.threatAvg = this.threatAvg * 0.5 + now * 0.5;
    const threat = Math.max(now, this.threatAvg);

    const hunger = clamp01(1 - me.nest.store / (me.config.layFoodTarget * 2));
    const power = (c: Colony): number => c.castes[0] + c.castes[1] * SOLDIER_POWER;
    const strength = foe ? power(me) / Math.max(1, power(foe)) : 0;
    const opportunity = clamp01(strength - 1);

    const soldier = Math.min(
      p.soldierMax,
      Math.max(0.05, p.soldierBase + 0.45 * threat + 0.2 * opportunity - 0.15 * hunger),
    );
    const breeder = hunger < 0.2 && me.population > 600 ? 0.03 : 0;
    const caste = { worker: 1 - soldier - breeder, soldier, breeder };

    const room = me.broodCapacity;
    const behavior = {
      forage: 0.5 + 0.3 * hunger,
      dig: room < 4 ? 0.25 : 0.1,
      nurse: me.brood.count > 0 ? 0.2 : 0.1,
    };

    const soldiers = me.castes[1];
    let raid = me.raid;
    if (!foe || threat > 0.5) raid = false;
    else if (!raid) {
      raid = tick >= p.graceTicks && soldiers >= p.raidMinSoldiers && strength >= p.raidStrength;
    } else raid = soldiers >= p.raidMinSoldiers * 0.4;

    me.setCasteRatio(caste);
    me.setBehaviorRatio(behavior);
    me.raid = raid;
    this.state = {
      threat,
      hunger,
      opportunity,
      strength,
      caste: { ...me.casteRatio },
      behavior: { ...me.ratio },
      raid,
    };
  }
}
