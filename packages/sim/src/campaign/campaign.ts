import { Caste, PLAYER_COLONY, RED_COLONY } from '@ant/shared';
import type {
  CampaignConfig,
  CampaignSnapshot,
  CasteRatio,
  Difficulty,
  PatchInfo,
  SimConfigInput,
  SimEvent,
  Snapshot,
} from '@ant/shared';
import { STARVED_HP, compactAnts } from '../ants/store';
import { createRng } from '../rng';
import { createSim, restoreSim } from '../sim';
import type { Sim, SimExtras } from '../sim';
import { readSaveInfo } from '../save/format';
import { Footsteps } from './footsteps';
import type { FootstepsState } from './footsteps';
import { YARD_COLS, YARD_ROWS, buildLayout } from './layout';
import type { PatchDef } from './layout';
import { CAMPAIGN_DIFFICULTY, MODEL, SIDES, SIDE_COLONY, abstractTick, fly } from './model';
import type { ColonySummary, ModelContext, PatchState, Side } from './model';

/** Edge of a patch's detailed world (smaller than a Quick Game yard: patches are many). */
export const PATCH_WORLD_SIZE = 1536;
/** The black colony starts here (bottom-left of the yard); red in two patches across it. */
export const START_PATCH = 4 * YARD_COLS + 1;
const RED_STARTS = [1 * YARD_COLS + 6, 4 * YARD_COLS + 6];
/** Default share of black breeders in a campaign (Quick Game colonies raise none). */
export const CAMPAIGN_BREEDER_SHARE = 0.12;

/** Everything the campaign owns besides the detailed sim. Plain data: it is saved. */
export interface CampaignState {
  seed: number;
  difficulty: Difficulty;
  maxAnts: number;
  /** Sim ticks since the campaign began (across patch switches). */
  tick: number;
  rng: number;
  active: number;
  season: number;
  meter: number;
  outcome: '' | 'victory' | 'defeat';
  /** The black caste ratio, carried from patch to patch. */
  casteRatio: CasteRatio;
  patches: PatchState[];
  footsteps: FootstepsState;
  version: number;
}

/**
 * SimAnt-style campaign: a yard of `YARD_COLS x YARD_ROWS` patches plus six house rooms.
 * Exactly one patch (the active one) is a full detailed `Sim`; every other patch is a
 * `PatchState` summary advanced by the abstract model (`model.ts`) once per `MODEL.interval`
 * ticks. Entering another patch collapses the detailed sim into its summary and builds the
 * target's world from its seed + summary.
 *
 * Saving: the campaign registers a `campaign` module on the detailed sim (`SimExtras`), so
 * `sim.serialize()` writes summaries and detail in one ordinary save; `restoreCampaign`
 * reads it back.
 */
export class Campaign {
  sim!: Sim;
  defs: PatchDef[];
  private s: CampaignState;
  private rng;
  private feet: Footsteps;
  private events: SimEvent[] = [];
  private sentVersion = -1;
  /** Live black ants in the house (summaries + the detailed room), refreshed each abstract tick. */
  private indoor = 0;
  readonly extras: SimExtras = {
    modules: [
      {
        key: 'campaign',
        getState: () => this.getState(),
        setState: (st: CampaignState) => this.setState(st),
      },
    ],
    saveInfo: () => ({
      // The slot list shows time played: the whole campaign's, not this patch's.
      tick: this.s.tick,
      campaign: {
        owned: this.owned('black'),
        patches: this.defs.length,
        difficulty: this.s.difficulty,
      },
    }),
  };

  /** A new campaign. Pass `restoring` to get an empty shell for `restoreCampaign`. */
  constructor(config: CampaignConfig, restoring = false) {
    this.defs = buildLayout(config.seed);
    this.rng = createRng(config.seed ^ 0xca3a1167);
    this.feet = new Footsteps(config.seed);
    this.s = {
      seed: config.seed,
      difficulty: config.difficulty,
      maxAnts: config.maxAnts ?? 0,
      tick: 0,
      rng: 0,
      active: START_PATCH,
      season: 0,
      meter: 0,
      outcome: '',
      casteRatio: { worker: 0.76, soldier: 0.12, breeder: CAMPAIGN_BREEDER_SHARE },
      patches: this.defs.map((d) => ({
        food: Math.round(d.foodCap * 0.6),
        black: null,
        red: null,
      })),
      footsteps: this.feet.getState(),
      version: 0,
    };
    if (restoring) return;
    this.s.patches[START_PATCH]!.black = { pop: 120, breeders: 0, food: 60 };
    for (const id of RED_STARTS) this.s.patches[id]!.red = { pop: 100, breeders: 0, food: 60 };
    this.sim = this.buildSim(START_PATCH);
    this.updateIndoor();
  }

  get difficulty(): Difficulty {
    return this.s.difficulty;
  }
  get active(): number {
    return this.s.active;
  }
  get tick(): number {
    return this.s.tick;
  }
  get outcome(): '' | 'victory' | 'defeat' {
    return this.s.outcome;
  }
  get over(): boolean {
    return this.s.outcome !== '';
  }
  get meter(): number {
    return this.s.meter;
  }
  /** Summaries (the active patch's is synced from the sim every abstract tick). */
  get patches(): readonly PatchState[] {
    return this.s.patches;
  }

  /** Patches holding a colony of `side`. */
  owned(side: Side): number {
    let n = 0;
    for (const p of this.s.patches) if (p[side]) n++;
    return n;
  }

  /** Black breeders ready to fly (the detailed patch counts its breeder ants). */
  blackBreeders(): number {
    let n = 0;
    this.s.patches.forEach((p, id) => {
      if (!p.black) return;
      n +=
        id === this.s.active
          ? (this.liveBlack()?.castes[Caste.Breeder] ?? 0)
          : Math.floor(p.black.breeders);
    });
    return n;
  }

  /** The detailed sim's black colony, while its queen lives. */
  private liveBlack() {
    const c = this.sim.colonies[PLAYER_COLONY];
    return c?.queenAlive ? c : null;
  }

  private bump(): void {
    this.s.version++;
  }

  // --- Detailed world <-> summary ---------------------------------------------------------

  /** Build the detailed sim of patch `id` from its seed and summary. */
  private buildSim(id: number): Sim {
    const def = this.defs[id]!;
    const p = this.s.patches[id]!;
    const room = def.kind === 'room';
    const piles = Math.max(1, Math.min(def.piles, Math.ceil(p.food / 400)));
    const config: SimConfigInput = {
      seed: def.seed,
      worldSize: PATCH_WORLD_SIZE,
      initialAnts: 0,
      colonies: p.red ? 2 : 1,
      difficulty: this.s.difficulty,
      foodSources: p.food >= 1 ? piles : 0,
      foodAmount: Math.max(1, p.food / piles),
      spiders: def.spider ? 1 : 0,
      antlions: def.antlion ? 1 : 0,
      rain: { enabled: !room },
      // Yard patches get the mower and a walking human at their own frequency; rooms have the
      // campaign's house footsteps instead.
      lawnmower: { enabled: def.mower > 0, frequency: def.mower || 1 },
      yardSteps: { enabled: def.walkers > 0, frequency: def.walkers || 1 },
      winLose: false,
      colony: { casteRatio: { ...this.s.casteRatio } },
      ...(this.s.maxAnts > 0 ? { maxAnts: this.s.maxAnts } : {}),
    };
    const sim = createSim(config, this.extras);
    const populate = (c: ColonySummary | null, colony: number): void => {
      const col = sim.colonies[colony];
      if (!c || !col) return;
      col.nest.store = c.food;
      const breeders = Math.min(Math.floor(c.breeders), Math.round(c.pop));
      const rest = Math.round(c.pop) - breeders;
      // Breeders exist only as counted in the summary; the rest split by the caste ratio.
      const r = col.casteRatio;
      const soldiers = Math.round((rest * r.soldier) / (r.worker + r.soldier || 1));
      const { x, y } = col.nest;
      sim.applyCommands([
        { type: 'spawnAnts', count: rest - soldiers, x, y, colony, caste: Caste.Worker },
        { type: 'spawnAnts', count: soldiers, x, y, colony, caste: Caste.Soldier },
        { type: 'spawnAnts', count: breeders, x, y, colony, caste: Caste.Breeder },
      ]);
    };
    populate(p.black, PLAYER_COLONY);
    populate(p.red, RED_COLONY);
    sim.player.reset();
    this.feet.clear();
    return sim;
  }

  /** Write the detailed sim's numbers into the active patch's summary. */
  private syncActive(): void {
    const id = this.s.active;
    const p = this.s.patches[id]!;
    const sim = this.sim;
    let food = 0;
    for (const f of sim.world.food.list()) food += f.amount;
    p.food = food;
    for (const side of SIDES) {
      const summary = p[side];
      const col = sim.colonies[SIDE_COLONY[side]];
      if (!summary) continue;
      if (!col || !col.queenAlive || col.population <= 0) {
        p[side] = null;
        this.destroyed(side, id);
        continue;
      }
      summary.pop = col.population + col.brood.count * 0.5;
      summary.food = col.nest.store;
      summary.breeders = side === 'black' ? col.castes[Caste.Breeder] : summary.breeders;
    }
    const black = sim.colonies[PLAYER_COLONY];
    if (black) this.s.casteRatio = { ...black.casteRatio };
  }

  /**
   * Leave the current patch for `id` (which needs a black colony). Returns false (and changes
   * nothing) otherwise. The new detailed sim replaces `this.sim`.
   */
  enter(id: number): boolean {
    if (this.over || id === this.s.active || !this.s.patches[id]?.black) return false;
    this.syncActive();
    if (!this.s.patches[id].black) return false;
    this.s.active = id;
    this.sim = this.buildSim(id);
    this.events.push({ type: 'patchEntered', patch: id });
    this.bump();
    return true;
  }

  // --- Ticking ----------------------------------------------------------------------------

  /** One sim tick of the detailed patch, house feet, and (every interval) the abstract model. */
  step(): void {
    if (this.over) return;
    const sim = this.sim;
    sim.step();
    const def = this.defs[this.s.active]!;
    if (def.kind === 'room') {
      const diff = CAMPAIGN_DIFFICULTY[this.s.difficulty];
      this.feet.step(
        sim.ants,
        sim.config.worldSize,
        this.indoor / diff.indoorTarget,
        diff.humans,
        this.events,
      );
    }
    this.s.tick++;
    if (this.s.tick % MODEL.interval === 0) this.abstractStep();
  }

  private context(): ModelContext {
    return {
      defs: this.defs,
      patches: this.s.patches,
      difficulty: this.s.difficulty,
      blackBreederShare: this.s.casteRatio.breeder,
      active: this.s.active,
      indoor: this.indoor,
      destroyed: [],
    };
  }

  /** The abstract model's tick: summaries, seasons, the house meter and the end of the game. */
  private abstractStep(): void {
    this.syncActive();
    const ctx = this.context();
    abstractTick(ctx);
    for (const d of ctx.destroyed) this.destroyed(d.side, d.patch);
    // Red in the detailed patch raises breeders abstractly (the sim's red colony raises none).
    const red = this.s.patches[this.s.active]!.red;
    if (red) {
      const share = CAMPAIGN_DIFFICULTY[this.s.difficulty].red.breeders;
      red.breeders = Math.min(red.pop * 0.3, red.breeders + red.pop * 0.01 * share * 10);
    }
    this.topUpFood();
    this.updateIndoor();
    this.updateMeter();
    const season = Math.floor(this.s.tick / (MODEL.interval * MODEL.seasonLength));
    if (season > this.s.season) {
      this.s.season = season;
      this.events.push({ type: 'season', season });
      this.seasonalFlights();
    }
    this.checkOutcome();
    this.bump();
  }

  /** The detailed patch regrows food slowly too: a new pile now and then while it is bare. */
  private topUpFood(): void {
    const def = this.defs[this.s.active]!;
    const p = this.s.patches[this.s.active]!;
    if (p.food >= def.foodCap * 0.5 || this.rng.next() > 0.25) return;
    const size = this.sim.config.worldSize;
    this.sim.applyCommands([
      {
        type: 'placeFood',
        x: this.rng.range(size * 0.1, size * 0.9),
        y: this.rng.range(size * 0.1, size * 0.9),
        amount: def.foodRegen * 8,
      },
    ]);
  }

  private updateIndoor(): void {
    let n = 0;
    this.s.patches.forEach((p, id) => {
      if (this.defs[id]!.kind === 'room' && p.black) n += p.black.pop;
    });
    this.indoor = n;
  }

  private updateMeter(): void {
    const target = CAMPAIGN_DIFFICULTY[this.s.difficulty].indoorTarget;
    if (this.indoor >= target) {
      this.s.meter += Math.min(2, this.indoor / target) / MODEL.meterFill;
    } else {
      this.s.meter -= 1 / MODEL.meterDrain;
    }
    this.s.meter = Math.min(1, Math.max(0, this.s.meter));
  }

  private destroyed(side: Side, patch: number): void {
    this.events.push({ type: 'colonyDestroyed', colony: SIDE_COLONY[side], patch });
  }

  private checkOutcome(): void {
    if (this.over) return;
    if (this.s.meter >= 1) {
      this.s.outcome = 'victory';
      this.events.push({ type: 'campaignOver', won: true, reason: 'humansLeft' });
    } else if (this.owned('black') === 0) {
      this.s.outcome = 'defeat';
      this.events.push({ type: 'campaignOver', won: false, reason: 'lastColony' });
    }
  }

  // --- Mating flights ---------------------------------------------------------------------

  /** Take breeders out of the detailed sim's black colony (they fly off the map). */
  private launchLiveBreeders(): number {
    const col = this.liveBlack();
    if (!col) return 0;
    const { ants, player } = this.sim;
    let n = 0;
    for (let i = 0; i < ants.count; i++) {
      if (ants.colony[i] !== PLAYER_COLONY || ants.caste[i] !== Caste.Breeder) continue;
      if (i === player.index || ants.hp[i]! <= 0) continue;
      ants.hp[i] = STARVED_HP;
      col.population--;
      col.castes[Caste.Breeder]--;
      n++;
    }
    if (n) {
      const old = ants.count;
      const remap = new Int32Array(old);
      compactAnts(ants, remap);
      player.applyRemap(remap, old);
    }
    return n;
  }

  /**
   * Fly every colony of `side` that has at least `min` breeders. Returns the patches where
   * new colonies were founded.
   */
  private flights(side: Side, min: number): number[] {
    const ctx = this.context();
    const founded: number[] = [];
    let total = 0;
    for (let id = 0; id < this.s.patches.length; id++) {
      const c = this.s.patches[id]![side];
      if (!c) continue;
      let n: number;
      if (id === this.s.active && side === 'black') {
        if ((this.liveBlack()?.castes[Caste.Breeder] ?? 0) < min) continue;
        n = this.launchLiveBreeders();
        c.pop = Math.max(0, c.pop - n);
        c.breeders = 0;
      } else {
        n = Math.floor(c.breeders);
        if (n < min || n < 1) continue;
        c.breeders -= n;
        c.pop -= n;
      }
      total += n;
      const r = fly(ctx, this.rng, side, id, n, this.s.active);
      founded.push(...r.founded);
    }
    if (total > 0) {
      const colony = SIDE_COLONY[side];
      this.events.push({ type: 'matingFlight', colony, breeders: total, founded });
      for (const patch of founded) this.events.push({ type: 'colonyFounded', colony, patch });
      this.updateIndoor();
      this.bump();
    }
    return founded;
  }

  /**
   * The player's mating flight: every black colony's breeders leave at once. Needs at least
   * `MODEL.flightMin` breeders in total; returns the patches where colonies were founded, or
   * null when there weren't enough breeders.
   */
  matingFlight(): number[] | null {
    if (this.over || this.blackBreeders() < MODEL.flightMin) return null;
    this.syncActive();
    return this.flights('black', 1);
  }

  private seasonalFlights(): void {
    this.flights('red', MODEL.seasonalMin);
    if (this.blackBreeders() >= MODEL.flightMin) this.flights('black', MODEL.seasonalMin);
  }

  // --- Output -----------------------------------------------------------------------------

  info(): CampaignSnapshot {
    const target = CAMPAIGN_DIFFICULTY[this.s.difficulty].indoorTarget;
    const active = this.s.active;
    const live = this.liveBlack();
    const patches: PatchInfo[] = this.defs.map((d) => {
      const p = this.s.patches[d.id]!;
      return {
        id: d.id,
        col: d.col,
        row: d.row,
        kind: d.kind,
        name: d.name,
        black: Math.round(p.black?.pop ?? 0),
        red: Math.round(p.red?.pop ?? 0),
        blackBreeders:
          d.id === active && p.black
            ? (live?.castes[Caste.Breeder] ?? 0)
            : Math.floor(p.black?.breeders ?? 0),
        redBreeders: Math.floor(p.red?.breeders ?? 0),
        food: Math.round(p.food),
      };
    });
    const seasonTicks = MODEL.interval * MODEL.seasonLength;
    return {
      version: this.s.version,
      difficulty: this.s.difficulty,
      cols: YARD_COLS,
      rows: YARD_ROWS,
      patches,
      active,
      owned: this.owned('black'),
      redOwned: this.owned('red'),
      breeders: this.blackBreeders(),
      flightMin: MODEL.flightMin,
      season: this.s.season,
      seasonProgress: (this.s.tick % seasonTicks) / seasonTicks,
      infestation: this.s.meter,
      indoor: Math.round(this.indoor),
      indoorTarget: target,
      outcome: this.s.outcome,
    };
  }

  /**
   * The detailed sim's snapshot plus campaign events, house feet and (when it changed, or
   * when `force` is set) the map overview.
   */
  snapshot(options?: Parameters<Sim['snapshot']>[0] & { campaign?: boolean }): Snapshot {
    const snap = this.sim.snapshot(options);
    if (this.events.length) {
      snap.events.push(...this.events);
      this.events = [];
    }
    if (this.feet.count) snap.footsteps = this.feet.info();
    if (options?.campaign || this.sentVersion !== this.s.version) {
      this.sentVersion = this.s.version;
      snap.campaign = this.info();
    }
    return snap;
  }

  serialize(): Uint8Array {
    return this.sim.serialize();
  }

  getState(): CampaignState {
    return structuredClone({
      ...this.s,
      rng: this.rng.getState(),
      footsteps: this.feet.getState(),
    });
  }

  setState(st: CampaignState): void {
    if (st.seed !== this.s.seed) {
      this.defs = buildLayout(st.seed);
      this.rng = createRng(st.seed ^ 0xca3a1167);
      this.feet = new Footsteps(st.seed);
    }
    this.s = structuredClone(st);
    this.rng.setState(st.rng);
    this.feet.setState(st.footsteps);
    this.sentVersion = -1;
    this.updateIndoor();
  }
}

/** Is this save a campaign? (Reads only the header.) */
export function isCampaignSave(bytes: Uint8Array): boolean {
  return !!readSaveInfo(bytes).campaign;
}

/** Rebuild a campaign (summaries + the detailed patch) from `Campaign.serialize` bytes. */
export function restoreCampaign(bytes: Uint8Array): Campaign {
  const info = readSaveInfo(bytes);
  if (!info.campaign) throw new Error('not a campaign save');
  // The header's seed is the patch's; the campaign module's state brings the campaign seed.
  const campaign = new Campaign({ seed: info.seed, difficulty: info.campaign.difficulty }, true);
  campaign.sim = restoreSim(bytes, campaign.extras);
  return campaign;
}
