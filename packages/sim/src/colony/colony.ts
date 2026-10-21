import { AntRole, AntState, Caste, NEST_TILE, undergroundLayer } from '@ant/shared';
import type {
  AntBehaviorConfig,
  BehaviorRatio,
  CasteRatio,
  ColonyConfig,
  ColonySnapshot,
  CombatConfig,
  NestGridSnapshot,
  SimEvent,
} from '@ant/shared';
import type { AntStore } from '../ants/store';
import { STARVED_HP } from '../ants/store';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import type { Nest } from '../world/nest';
import { DigPlanner } from '../underground/digplan';
import type { DigPlannerState } from '../underground/digplan';
import { FlowField } from '../underground/flow';
import type { FlowFieldState } from '../underground/flow';
import { NestGrid } from '../underground/grid';
import type { NestGridState } from '../underground/grid';
import { updateUndergroundAnts } from '../underground/ants';
import { Brood, BroodStage } from './brood';
import type { BroodState } from './brood';
import { mostNeededRole, normaliseRatio, rebalanceRoles, roleTargets } from './roles';

export interface ColonyState {
  nestStore: number;
  rng: number;
  grid: NestGridState;
  planner: DigPlannerState;
  flows: FlowFieldState[];
  fieldsVersion: number;
  brood: BroodState;
  ratio: BehaviorRatio;
  casteRatio: CasteRatio;
  raid: boolean;
  queenAlive: boolean;
  queenHp: number;
  lost: boolean;
  dirt: number;
  digTarget: number;
  digProgress: number;
  digWorkers: number;
  lastDigger: number;
  nursesTending: number;
  population: number;
  castes: number[];
  underground: number;
  fighting: number;
  intruders: number;
  threat: number;
  scouted: boolean;
  losses: number;
  layProgress: number;
  starveProgress: number;
  hunger: number;
  nursing: number;
  roleCount: number[];
  roleTarget: number[];
  tick: number;
}

/** Roles are re-evaluated this often (ticks). */
const REBALANCE_INTERVAL = 10;

export interface ColonyOptions {
  id: number;
  config: ColonyConfig;
  combat: CombatConfig;
  nest: Nest;
  /** Seeds the nest layout and dig plan. Independent of the ant rng. */
  seed: number;
  /** Where the queen chamber sits is derived from the grid; the entrance column defaults to centre. */
  grid?: NestGrid;
  /** Receives one-shot events (queen death). */
  onEvent?: (e: SimEvent) => void;
}

/**
 * One ant colony: its underground nest (tile grid, flow fields, dig plan), brood, queen
 * and economy. All colonies share one `AntStore`; an ant belongs to colony `ants.colony[i]`,
 * and is inside this colony's nest when `ants.layer[i] === undergroundLayer(id)` (which
 * includes enemy raiders).
 *
 * Per-tick head counts (`population`, `castes`, `intruders`, ...) are filled in by
 * `takeCensus` before `step` runs.
 *
 * Per tick (`step`): rebalance roles -> refresh flow fields -> move ants in the nest
 * (own and raiders) -> complete digging -> queen lays -> brood develops (nurses speed it
 * up; pupae emerge as workers/soldiers/breeders per `casteRatio`) -> upkeep/starvation.
 */
export class Colony {
  readonly id: number;
  readonly config: ColonyConfig;
  readonly combat: CombatConfig;
  readonly nest: Nest;
  readonly grid: NestGrid;
  readonly brood = new Brood();
  /** `ants.layer` value of ants inside this nest. */
  readonly layer: number;

  // Flow fields (walking distance to the thing named).
  readonly toEntrance: FlowField;
  readonly toFood: FlowField;
  readonly toNursery: FlowField;
  readonly toDig: FlowField;
  readonly toQueen: FlowField;
  private fieldsVersion = -1;
  private planner: DigPlanner;
  /** Nest layout / dig-plan stream; its state is saved. */
  private readonly rng: Rng;

  ratio: BehaviorRatio;
  casteRatio: CasteRatio;
  /** Soldiers raid the enemy nest instead of patrolling near home. */
  raid = false;
  queenAlive = true;
  queenHp: number;
  lost = false;
  readonly queenTile: number;
  /** Dirt hauled out of the nest (drives the surface mound). */
  dirt = 0;

  // Dig state.
  digTarget = -1;
  digProgress = 0;
  /** Per-tick scratch written by the underground ant step. */
  digWorkers = 0;
  lastDigger = -1;
  nursesTending = 0;

  // Census (see `takeCensus`), refreshed every tick.
  population = 0;
  readonly castes: [number, number, number] = [0, 0, 0];
  underground = 0;
  fighting = 0;
  /** Enemy ants inside this nest. */
  intruders = 0;
  /** Enemy surface ants within `threatRadius` of the entrance. */
  threat = 0;
  /** An enemy ant has been within `scoutRadius` of the entrance (sticky). */
  scouted = false;
  /** Ants lost so far (combat + starvation). Updated by the sim when ants are removed. */
  losses = 0;

  // Economy state.
  private layProgress = 0;
  private starveProgress = 0;
  /** Consecutive ticks with an empty store. */
  hunger = 0;
  nursing = 1;
  readonly roleCount: number[] = [0, 0, 0];
  private roleTarget: number[] = [0, 0, 0];
  /** Index of an ant that must not starve (the player ant), or -1. */
  protectedIndex: () => number = () => -1;
  private onEvent: (e: SimEvent) => void;
  private lastSentVersion = -1;
  private tick = 0;

  constructor(opts: ColonyOptions) {
    this.id = opts.id;
    this.layer = undergroundLayer(opts.id);
    this.config = opts.config;
    this.combat = opts.combat;
    this.nest = opts.nest;
    this.onEvent = opts.onEvent ?? (() => {});
    const rng = createRng(opts.seed ^ Math.imul(opts.id + 1, 0x85ebca6b));
    this.rng = rng;
    this.grid = opts.grid ?? new NestGrid();
    this.grid.generate(rng);
    this.planner = new DigPlanner(this.grid, rng);
    this.toEntrance = new FlowField(this.grid);
    this.toFood = new FlowField(this.grid);
    this.toNursery = new FlowField(this.grid);
    this.toDig = new FlowField(this.grid);
    this.toQueen = new FlowField(this.grid);
    this.ratio = normaliseRatio(opts.config.behaviorRatio);
    this.casteRatio = normaliseCaste(opts.config.casteRatio);
    this.queenTile = this.grid.idx(this.grid.entranceX, 9);
    this.queenHp = opts.combat.queenHp;
    this.nest.store = opts.config.startFood;
  }

  /** World-space position of the entrance tile centre (underground coordinates). */
  get entranceX(): number {
    return (this.grid.entranceX + 0.5) * NEST_TILE;
  }

  get broodCapacity(): number {
    return Math.max(0, this.grid.nurseryCount * this.config.broodPerTile - this.brood.count);
  }

  setBehaviorRatio(r: BehaviorRatio): void {
    this.ratio = normaliseRatio(r);
  }

  setCasteRatio(r: CasteRatio): void {
    this.casteRatio = normaliseCaste(r);
  }

  /**
   * A surface ant at this nest's entrance goes underground, keeping whatever it carries.
   * Enemy raiders enter the same way.
   */
  enter(ants: AntStore, i: number): void {
    ants.layer[i] = this.layer;
    ants.x[i] = this.entranceX;
    ants.y[i] = NEST_TILE * 0.5;
    ants.heading[i] = Math.PI / 2;
    ants.state[i] = ants.carrying[i]! > 0 ? AntState.CarryFood : roleState(ants.role[i]!);
  }

  /** An underground ant at the entrance steps out onto the surface next to the nest. */
  exit(ants: AntStore, i: number, rng: Rng): void {
    const a = rng.range(0, Math.PI * 2);
    const r = this.nest.radius * 1.4;
    ants.layer[i] = 0;
    ants.x[i] = this.nest.x + Math.cos(a) * r;
    ants.y[i] = this.nest.y + Math.sin(a) * r;
    ants.heading[i] = a;
    ants.strength[i] = 1;
    ants.state[i] = AntState.Wander;
    if (ants.carrying[i]! < 0) this.dirt++;
    ants.carrying[i] = 0;
  }

  /** Surface ant whose job is underground: walk to the nest mouth and descend. */
  walkToNest(ants: AntStore, i: number, rng: Rng, cfg: AntBehaviorConfig, tickRate: number): void {
    const dx = this.nest.x - ants.x[i]!;
    const dy = this.nest.y - ants.y[i]!;
    const h = Math.atan2(dy, dx) + (rng.next() * 2 - 1) * cfg.jitter;
    const v = cfg.speed / tickRate;
    ants.x[i] = ants.x[i]! + Math.cos(h) * v;
    ants.y[i] = ants.y[i]! + Math.sin(h) * v;
    ants.heading[i] = h;
    ants.state[i] = roleState(ants.role[i]!);
    if (this.nest.isAtNest(ants.x[i], ants.y[i])) this.enter(ants, i);
  }

  step(ants: AntStore, rng: Rng, cfg: AntBehaviorConfig, tickRate: number): void {
    const c = this.config;
    if (this.tick % REBALANCE_INTERVAL === 0) {
      rebalanceRoles(ants, this.id, this.ratio, this.roleCount, this.roleTarget);
    }
    this.tick++;
    this.refreshFields();

    this.digWorkers = 0;
    this.lastDigger = -1;
    this.nursesTending = 0;
    updateUndergroundAnts(this, ants, rng, cfg, tickRate);
    this.finishDig(ants);

    // Nursing: tending nurses per brood item, saturating at `nursesPerBrood`.
    const need = Math.max(1, this.brood.count * c.nursesPerBrood);
    this.nursing = 1 + c.nurseBoost * Math.min(1, this.nursesTending / need);

    if (this.queenAlive) this.layEggs();
    this.developBrood(ants, rng);
    this.upkeep(ants, rng);
  }

  private refreshFields(): void {
    const g = this.grid;
    if (this.fieldsVersion !== g.version) {
      this.fieldsVersion = g.version;
      this.toEntrance.rebuild([g.entranceIndex]);
      this.toFood.rebuild(g.foodTiles);
      this.toNursery.rebuild(g.nurseryTiles);
      this.toQueen.rebuild(g.queenTiles);
      this.toDig.dirty = true;
    }
    const full = g.openCount >= g.size * this.config.maxOpenFraction;
    if (full) {
      if (this.digTarget !== -1) this.digTarget = -1;
    } else if (this.digTarget < 0 || g.tiles[this.digTarget] !== 0 /* Soil */) {
      this.digTarget = this.planner.target();
      this.digProgress = 0;
      this.toDig.dirty = true;
    }
    if (this.toDig.dirty) {
      const goals: number[] = [];
      const t = this.digTarget;
      if (t >= 0) {
        const w = g.width;
        for (const n of [t - 1, t + 1, t - w, t + w]) if (g.isOpenIndex(n)) goals.push(n);
      }
      this.toDig.rebuild(goals);
    }
  }

  private finishDig(ants: AntStore): void {
    if (this.digTarget < 0 || this.digProgress < this.config.digCost) return;
    this.digProgress = 0;
    this.planner.dig();
    this.digTarget = -1; // next tick's refreshFields picks the next target
    if (this.lastDigger >= 0) {
      ants.carrying[this.lastDigger] = -1;
      ants.state[this.lastDigger] = AntState.Dig;
    }
  }

  private layEggs(): void {
    const c = this.config;
    const store = this.nest.store;
    const rate = c.maxLayRate * Math.min(1, store / c.layFoodTarget);
    this.layProgress += rate;
    while (this.layProgress >= 1) {
      this.layProgress -= 1;
      if (this.nest.store < c.eggCost || this.broodCapacity < 1 || !this.brood.add()) {
        this.layProgress = Math.min(this.layProgress, 1);
        break;
      }
      this.nest.store -= c.eggCost;
    }
  }

  private developBrood(ants: AntStore, rng: Rng): void {
    const c = this.config;
    const b = this.brood;
    const durations = [c.eggTicks, c.larvaTicks, c.pupaTicks];
    let eggs = 0;
    let larvae = 0;
    let pupae = 0;
    for (let i = b.count - 1; i >= 0; i--) {
      let stage = b.stage[i]!;
      if (stage === BroodStage.Larva) {
        // Larvae eat; with an empty store they stall.
        if (this.nest.store < c.larvaFeedRate) {
          larvae++;
          continue;
        }
        this.nest.store -= c.larvaFeedRate;
      }
      const p = b.progress[i]! + this.nursing;
      if (p >= durations[stage]!) {
        if (stage === BroodStage.Pupa) {
          this.hatch(ants, rng);
          b.remove(i);
          continue;
        }
        stage++;
        b.stage[i] = stage;
        b.progress[i] = 0;
      } else b.progress[i] = p;
      if (stage === BroodStage.Egg) eggs++;
      else if (stage === BroodStage.Larva) larvae++;
      else pupae++;
    }
    b.eggs = eggs;
    b.larvae = larvae;
    b.pupae = pupae;
  }

  /** Caste for the next adult: the one furthest below its `casteRatio` share. */
  nextCaste(): number {
    const total = this.population + 1;
    const r = this.casteRatio;
    const gaps = [
      r.worker * total - this.castes[0],
      r.soldier * total - this.castes[1],
      r.breeder * total - this.castes[2],
    ];
    let best = 0;
    for (let k = 1; k < 3; k++) if (gaps[k]! > gaps[best]!) best = k;
    return best;
  }

  /** A pupa emerges as an adult in a nursery chamber, with its caste from `casteRatio`. */
  private hatch(ants: AntStore, rng: Rng): void {
    if (ants.count >= ants.capacity) return;
    const tiles = this.grid.nurseryTiles;
    const tile = tiles.length ? tiles[rng.int(tiles.length)]! : this.queenTile;
    const w = this.grid.width;
    const tx = tile % w;
    const ty = (tile - tx) / w;
    const i = ants.count++;
    const caste = this.nextCaste();
    ants.layer[i] = this.layer;
    ants.x[i] = (tx + rng.next()) * NEST_TILE;
    ants.y[i] = (ty + rng.next()) * NEST_TILE;
    ants.heading[i] = rng.range(0, Math.PI * 2);
    ants.carrying[i] = 0;
    ants.strength[i] = 0;
    ants.colony[i] = this.id;
    ants.caste[i] = caste;
    ants.hp[i] = this.combat.hp[caste]!;
    this.population++;
    this.castes[caste]!++;
    let role: number = AntRole.Forage;
    if (caste === Caste.Breeder) role = AntRole.Nurse;
    else if (caste === Caste.Worker) {
      roleTargets(this.castes[0], this.ratio, this.roleTarget);
      role = Math.max(0, mostNeededRole(this.roleCount, this.roleTarget));
      this.roleCount[role]!++;
    }
    ants.role[i] = role;
    ants.state[i] = roleState(role);
  }

  private upkeep(ants: AntStore, rng: Rng): void {
    const c = this.config;
    const pop = this.population;
    const need = pop * c.upkeepPerAnt + (this.queenAlive ? c.queenUpkeep : 0);
    if (this.nest.store >= need) {
      this.nest.store -= need;
      this.hunger = 0;
      this.starveProgress = 0;
      return;
    }
    this.nest.store = 0;
    this.hunger++;
    this.starveProgress += pop * c.starveRate;
    const keep = this.protectedIndex();
    const { colony, hp } = ants;
    const n = ants.count;
    while (this.starveProgress >= 1 && n > 0) {
      this.starveProgress -= 1;
      // Random start, then the next living ant of this colony (deterministic probe).
      const start = rng.int(n);
      for (let k = 0; k < n; k++) {
        const v = (start + k) % n;
        if (colony[v] !== this.id || hp[v]! <= 0 || v === keep) continue;
        hp[v] = STARVED_HP; // removed (no corpse) at the end of the tick
        break;
      }
    }
    if (this.queenAlive && this.hunger >= c.queenStarveTicks) this.killQueen('starvation');
  }

  /** Raiders hurt the queen; at 0 HP she dies. */
  damageQueen(amount: number): void {
    if (!this.queenAlive) return;
    this.queenHp -= amount;
    if (this.queenHp <= 0) {
      this.queenHp = 0;
      this.killQueen('combat');
    }
  }

  /** Queen death: no more eggs; the colony is lost. */
  killQueen(cause: 'combat' | 'starvation' = 'starvation'): void {
    if (!this.queenAlive) return;
    this.queenAlive = false;
    this.queenHp = 0;
    this.lost = true;
    this.onEvent({ type: 'queenKilled', colony: this.id, cause });
  }

  /** Everything needed to continue this colony exactly, as plain data / typed arrays. */
  getState(): ColonyState {
    return {
      nestStore: this.nest.store,
      rng: this.rng.getState(),
      grid: this.grid.getState(),
      planner: this.planner.getState(),
      flows: this.flowFields().map((f) => f.getState()),
      fieldsVersion: this.fieldsVersion,
      brood: this.brood.getState(),
      ratio: { ...this.ratio },
      casteRatio: { ...this.casteRatio },
      raid: this.raid,
      queenAlive: this.queenAlive,
      queenHp: this.queenHp,
      lost: this.lost,
      dirt: this.dirt,
      digTarget: this.digTarget,
      digProgress: this.digProgress,
      digWorkers: this.digWorkers,
      lastDigger: this.lastDigger,
      nursesTending: this.nursesTending,
      population: this.population,
      castes: [...this.castes],
      underground: this.underground,
      fighting: this.fighting,
      intruders: this.intruders,
      threat: this.threat,
      scouted: this.scouted,
      losses: this.losses,
      layProgress: this.layProgress,
      starveProgress: this.starveProgress,
      hunger: this.hunger,
      nursing: this.nursing,
      roleCount: [...this.roleCount],
      roleTarget: [...this.roleTarget],
      tick: this.tick,
    };
  }

  setState(s: ColonyState): void {
    this.nest.store = s.nestStore;
    this.rng.setState(s.rng);
    this.grid.setState(s.grid);
    this.planner.setState(s.planner);
    this.flowFields().forEach((f, i) => f.setState(s.flows[i]!));
    this.fieldsVersion = s.fieldsVersion;
    this.brood.setState(s.brood);
    this.ratio = { ...s.ratio };
    this.casteRatio = { ...s.casteRatio };
    this.raid = s.raid;
    this.queenAlive = s.queenAlive;
    this.queenHp = s.queenHp;
    this.lost = s.lost;
    this.dirt = s.dirt;
    this.digTarget = s.digTarget;
    this.digProgress = s.digProgress;
    this.digWorkers = s.digWorkers;
    this.lastDigger = s.lastDigger;
    this.nursesTending = s.nursesTending;
    this.population = s.population;
    this.castes[0] = s.castes[0]!;
    this.castes[1] = s.castes[1]!;
    this.castes[2] = s.castes[2]!;
    this.underground = s.underground;
    this.fighting = s.fighting;
    this.intruders = s.intruders;
    this.threat = s.threat;
    this.scouted = s.scouted;
    this.losses = s.losses;
    this.layProgress = s.layProgress;
    this.starveProgress = s.starveProgress;
    this.hunger = s.hunger;
    this.nursing = s.nursing;
    for (let i = 0; i < 3; i++) {
      this.roleCount[i] = s.roleCount[i]!;
      this.roleTarget[i] = s.roleTarget[i]!;
    }
    this.tick = s.tick;
    // Not game state: make the next snapshot resend the (restored) nest grid.
    this.lastSentVersion = -1;
  }

  private flowFields(): FlowField[] {
    return [this.toEntrance, this.toFood, this.toNursery, this.toDig, this.toQueen];
  }

  /** Per-colony slice of a snapshot, from the latest census. */
  snapshotColony(): ColonySnapshot {
    const w = this.grid.width;
    return {
      id: this.id,
      nest: { x: this.nest.x, y: this.nest.y, radius: this.nest.radius },
      food: this.nest.store,
      queenAlive: this.queenAlive,
      queenHp: this.queenHp,
      queenMaxHp: this.combat.queenHp,
      queenX: this.queenTile % w,
      queenY: Math.floor(this.queenTile / w),
      lost: this.lost,
      eggs: this.brood.eggs,
      larvae: this.brood.larvae,
      pupae: this.brood.pupae,
      population: this.population,
      underground: this.underground,
      castes: [this.castes[0], this.castes[1], this.castes[2]],
      casteRatio: { ...this.casteRatio },
      fighting: this.fighting,
      losses: this.losses,
      intruders: this.intruders,
      raid: this.raid,
      scouted: this.scouted,
      roles: [this.roleCount[0]!, this.roleCount[1]!, this.roleCount[2]!],
      ratio: { ...this.ratio },
      broodCapacity: this.broodCapacity,
      dirt: this.dirt,
      openTiles: this.grid.openCount,
    };
  }

  /** The packed grid if it changed since the last call (or `force`), else undefined. */
  snapshotGrid(force = false): NestGridSnapshot | undefined {
    if (!force && this.lastSentVersion === this.grid.version) return undefined;
    this.lastSentVersion = this.grid.version;
    return {
      colony: this.id,
      version: this.grid.version,
      width: this.grid.width,
      height: this.grid.height,
      entranceX: this.grid.entranceX,
      cells: this.grid.pack(),
    };
  }
}

/** Parts >= 0 summing to 1 (all-zero falls back to all workers). */
export function normaliseCaste(r: CasteRatio): CasteRatio {
  const w = Math.max(0, r.worker) || 0;
  const s = Math.max(0, r.soldier) || 0;
  const b = Math.max(0, r.breeder) || 0;
  const sum = w + s + b;
  return sum > 0
    ? { worker: w / sum, soldier: s / sum, breeder: b / sum }
    : { worker: 1, soldier: 0, breeder: 0 };
}

export function roleState(role: number): number {
  return role === AntRole.Dig
    ? AntState.Dig
    : role === AntRole.Nurse
      ? AntState.Nurse
      : AntState.Wander;
}
