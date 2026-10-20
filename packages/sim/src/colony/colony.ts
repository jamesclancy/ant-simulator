import { AntRole, AntState, NEST_TILE } from '@ant/shared';
import type {
  AntBehaviorConfig,
  BehaviorRatio,
  CasteRatio,
  ColonyConfig,
  ColonySnapshot,
  NestGridSnapshot,
} from '@ant/shared';
import type { AntStore } from '../ants/store';
import { removeAnt } from '../ants/store';
import { createRng } from '../rng';
import type { Rng } from '../rng';
import type { Nest } from '../world/nest';
import { DigPlanner } from '../underground/digplan';
import { FlowField } from '../underground/flow';
import { NestGrid } from '../underground/grid';
import { updateUndergroundAnts } from '../underground/ants';
import { Brood, BroodStage } from './brood';
import { mostNeededRole, normaliseRatio, rebalanceRoles, roleTargets } from './roles';

/** Roles are re-evaluated this often (ticks). */
const REBALANCE_INTERVAL = 10;

export interface ColonyOptions {
  id: number;
  config: ColonyConfig;
  nest: Nest;
  /** Seeds the nest layout and dig plan. Independent of the ant rng. */
  seed: number;
  /** Where the queen chamber sits is derived from the grid; the entrance column defaults to centre. */
  grid?: NestGrid;
}

/**
 * One ant colony: its underground nest (tile grid, flow fields, dig plan), brood, queen
 * and economy. Everything is keyed off `id` and holds its own state, so a second (rival)
 * colony is just another instance with its own `Nest` and `AntStore` role/layer slots.
 *
 * Per tick (`step`): rebalance roles -> refresh flow fields -> move underground ants ->
 * complete digging -> queen lays -> brood develops (nurses speed it up) -> upkeep/starvation.
 */
export class Colony {
  readonly id: number;
  readonly config: ColonyConfig;
  readonly nest: Nest;
  readonly grid: NestGrid;
  readonly brood = new Brood();

  // Flow fields (walking distance to the thing named).
  readonly toEntrance: FlowField;
  readonly toFood: FlowField;
  readonly toNursery: FlowField;
  readonly toDig: FlowField;
  private fieldsVersion = -1;
  private planner: DigPlanner;

  ratio: BehaviorRatio;
  casteRatio: CasteRatio;
  queenAlive = true;
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

  // Economy state.
  private layProgress = 0;
  private starveProgress = 0;
  /** Consecutive ticks with an empty store. */
  hunger = 0;
  nursing = 1;
  readonly roleCount: number[] = [0, 0, 0];
  private roleTarget: number[] = [0, 0, 0];
  private nextBroodKey = 0;
  /** Index of an ant that must not starve (the player ant), or -1. */
  protectedIndex: () => number = () => -1;
  /** Called when swap-removal moves an ant from `from` to slot `to`. */
  onAntMoved: (from: number, to: number) => void = () => {};
  private lastSentVersion = -1;
  private tick = 0;

  constructor(opts: ColonyOptions) {
    this.id = opts.id;
    this.config = opts.config;
    this.nest = opts.nest;
    const rng = createRng(opts.seed ^ Math.imul(opts.id + 1, 0x85ebca6b));
    this.grid = opts.grid ?? new NestGrid();
    this.grid.generate(rng);
    this.planner = new DigPlanner(this.grid, rng);
    this.toEntrance = new FlowField(this.grid);
    this.toFood = new FlowField(this.grid);
    this.toNursery = new FlowField(this.grid);
    this.toDig = new FlowField(this.grid);
    this.ratio = normaliseRatio(opts.config.behaviorRatio);
    this.casteRatio = { ...opts.config.casteRatio };
    this.queenTile = this.grid.idx(this.grid.entranceX, 9);
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

  /** A surface ant at the entrance goes underground, keeping whatever it carries. */
  enter(ants: AntStore, i: number): void {
    ants.layer[i] = 1;
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
      rebalanceRoles(ants, this.ratio, this.roleCount, this.roleTarget);
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

  /** A pupa emerges as an adult worker in a nursery chamber. */
  private hatch(ants: AntStore, rng: Rng): void {
    if (ants.count >= ants.capacity) return;
    const tiles = this.grid.nurseryTiles;
    const tile = tiles.length ? tiles[rng.int(tiles.length)]! : this.queenTile;
    const w = this.grid.width;
    const tx = tile % w;
    const ty = (tile - tx) / w;
    const i = ants.count++;
    ants.layer[i] = 1;
    ants.x[i] = (tx + rng.next()) * NEST_TILE;
    ants.y[i] = (ty + rng.next()) * NEST_TILE;
    ants.heading[i] = rng.range(0, Math.PI * 2);
    ants.carrying[i] = 0;
    ants.strength[i] = 0;
    const total = ants.count;
    roleTargets(total, this.ratio, this.roleTarget);
    const role = Math.max(0, mostNeededRole(this.roleCount, this.roleTarget));
    ants.role[i] = role;
    this.roleCount[role]!++;
    ants.state[i] = roleState(role);
  }

  private upkeep(ants: AntStore, rng: Rng): void {
    const c = this.config;
    const need = ants.count * c.upkeepPerAnt + (this.queenAlive ? c.queenUpkeep : 0);
    if (this.nest.store >= need) {
      this.nest.store -= need;
      this.hunger = 0;
      this.starveProgress = 0;
      return;
    }
    this.nest.store = 0;
    this.hunger++;
    this.starveProgress += ants.count * c.starveRate;
    while (this.starveProgress >= 1 && ants.count > 0) {
      this.starveProgress -= 1;
      let victim = rng.int(ants.count);
      const keep = this.protectedIndex();
      if (victim === keep) {
        if (ants.count < 2) break;
        victim = (victim + 1) % ants.count;
      }
      const last = ants.count - 1;
      removeAnt(ants, victim);
      if (last !== victim) this.onAntMoved(last, victim);
    }
    if (this.queenAlive && this.hunger >= c.queenStarveTicks) this.killQueen();
  }

  /** Queen death: no more eggs; the colony is lost. */
  killQueen(): void {
    this.queenAlive = false;
    this.lost = true;
  }

  /** Per-colony slice of a snapshot. Counts roles and layers over the ant store. */
  snapshotColony(ants: AntStore): ColonySnapshot {
    const roles: [number, number, number] = [0, 0, 0];
    let underground = 0;
    for (let i = 0; i < ants.count; i++) {
      roles[ants.role[i]!]!++;
      underground += ants.layer[i]!;
    }
    const w = this.grid.width;
    return {
      id: this.id,
      queenAlive: this.queenAlive,
      queenX: this.queenTile % w,
      queenY: Math.floor(this.queenTile / w),
      lost: this.lost,
      eggs: this.brood.eggs,
      larvae: this.brood.larvae,
      pupae: this.brood.pupae,
      population: ants.count,
      underground,
      roles,
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
      version: this.grid.version,
      width: this.grid.width,
      height: this.grid.height,
      entranceX: this.grid.entranceX,
      cells: this.grid.pack(),
    };
  }
}

function roleState(role: number): number {
  return role === AntRole.Dig
    ? AntState.Dig
    : role === AntRole.Nurse
      ? AntState.Nurse
      : AntState.Wander;
}
