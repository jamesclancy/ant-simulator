import { Caste, PHEROMONE_TYPES } from '@ant/shared';
import { PheromoneField, createSim } from '@ant/sim';
import type { Sim } from '@ant/sim';

// Usage: bench [antCounts=5000,10000] [ticks=400]
const counts = (process.argv[2] ?? '5000,10000').split(',').map(Number);
const ticks = Number(process.argv[3] ?? 400);
// Long enough for foraging trails to form, so the measured ticks include carrying ants.
const warmup = 600;

function measure(sim: Sim, n: number, each?: (t: number) => void): number[] {
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    each?.(i);
    const t0 = performance.now();
    sim.step();
    samples.push(performance.now() - t0);
  }
  return samples.sort((a, b) => a - b);
}

function report(samples: number[], sim: Sim): void {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p = (q: number): number =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  const s0 = performance.now();
  sim.snapshot();
  const snapMs = performance.now() - s0;
  console.log(
    `  step ms/tick mean=${mean.toFixed(3)} p50=${p(0.5).toFixed(3)} p95=${p(0.95).toFixed(3)} max=${p(1).toFixed(3)}`,
  );
  console.log(`  snapshot=${snapMs.toFixed(3)}ms (budget: 8ms/tick at 20Hz on a mid-range phone)`);
}

// Single colony, full step(): steering + foraging + economy + pheromones.
for (const ants of counts) {
  const sim = createSim({
    seed: 1,
    initialAnts: ants,
    colonies: 1,
    worldSize: 2048,
    foodAmount: 5000,
  });
  for (let i = 0; i < warmup; i++) sim.step();
  const samples = measure(sim, ticks);
  let loaded = 0;
  let under = 0;
  for (let i = 0; i < sim.ants.count; i++) {
    if (sim.ants.carrying[i]! > 0) loaded++;
    if (sim.ants.layer[i]) under++;
  }
  console.log(
    `1 colony: ants=${sim.ants.count} ticks=${ticks} carrying=${loaded} underground=${under} (${((100 * under) / sim.ants.count).toFixed(0)}%) openTiles=${sim.colony.grid.openCount} colonyFood=${sim.world.nest.store.toFixed(0)}`,
  );
  report(samples, sim);
}

// Two colonies x 3000 ants, both raiding, with fresh soldiers fed into a mid-map brawl
// so the measured ticks always include fighting, deaths, corpses and compaction.
{
  const per = 3000;
  const sim = createSim({ seed: 1, initialAnts: per, worldSize: 2048, foodAmount: 5000 });
  for (let i = 0; i < warmup; i++) sim.step();
  sim.applyCommands([
    { type: 'setRaid', colony: 0, on: true },
    { type: 'setRaid', colony: 1, on: true },
  ]);
  const [a, b] = sim.world.nests;
  const mx = (a!.x + b!.x) / 2;
  const my = (a!.y + b!.y) / 2;
  let fightingTicks = 0;
  let fightingSum = 0;
  const lossesBefore = sim.colonies.reduce((s, c) => s + c.losses, 0);
  const samples = measure(sim, ticks, (t) => {
    if (t % 40 === 0) {
      sim.applyCommands([
        { type: 'spawnAnts', count: 40, x: mx - 15, y: my, colony: 0, caste: Caste.Soldier },
        { type: 'spawnAnts', count: 40, x: mx + 15, y: my, colony: 1, caste: Caste.Soldier },
      ]);
    }
    const f = sim.colonies[0]!.fighting + sim.colonies[1]!.fighting;
    fightingSum += f;
    if (f > 0) fightingTicks++;
  });
  const deaths = sim.colonies.reduce((s, c) => s + c.losses, 0) - lossesBefore;
  const pops = sim.colonies.map((c) => c.population).join('/');
  console.log(
    `2 colonies: ants=${sim.ants.count} (${pops}) ticks=${ticks} fighting avg=${(fightingSum / ticks).toFixed(0)} in ${fightingTicks}/${ticks} ticks, deaths=${deaths}, food piles=${sim.world.food.size}`,
  );
  report(samples, sim);
}

// Pheromones: update() at 256x256 x 4 layers with a busy field (all layers non-empty).
{
  const field = new PheromoneField({ worldSize: 2048, resolution: 256, types: PHEROMONE_TYPES });
  for (let i = 0; i < 40000; i++) {
    field.deposit(PHEROMONE_TYPES[i % 4]!, (i * 37) % 2048, (i * 91) % 2048, 0.5);
  }
  for (let i = 0; i < 20; i++) field.update();
  const n = 200;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) field.update();
  const upd = (performance.now() - t0) / n;
  const q0 = performance.now();
  const out = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < n; i++) field.quantize(out);
  const quant = (performance.now() - q0) / n;
  console.log(
    `pheromones 256x256x4 (dense): update=${upd.toFixed(3)}ms/tick quantize=${quant.toFixed(3)}ms/snapshot`,
  );
}
