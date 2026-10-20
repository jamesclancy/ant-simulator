import { PheromoneField, createSim } from '@ant/sim';

// Usage: bench [antCounts=5000,10000] [ticks=400]
const counts = (process.argv[2] ?? '5000,10000').split(',').map(Number);
const ticks = Number(process.argv[3] ?? 400);
// Long enough for foraging trails to form, so the measured ticks include carrying ants.
const warmup = 600;

// Full step(): steering + foraging + pheromone update, on the default 5-pile world.
for (const ants of counts) {
  const sim = createSim({ seed: 1, initialAnts: ants, worldSize: 2048, foodAmount: 5000 });
  for (let i = 0; i < warmup; i++) sim.step();

  const samples: number[] = [];
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now();
    sim.step();
    samples.push(performance.now() - t0);
  }
  const s0 = performance.now();
  sim.snapshot();
  const snapMs = performance.now() - s0;

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const p = (q: number): number =>
    samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]!;
  let loaded = 0;
  for (let i = 0; i < sim.ants.count; i++) if (sim.ants.carrying[i]! > 0) loaded++;

  console.log(
    `ants=${sim.ants.count} ticks=${ticks} carrying=${loaded} colonyFood=${sim.world.nest.store}`,
  );
  console.log(
    `  step ms/tick mean=${mean.toFixed(3)} p50=${p(0.5).toFixed(3)} p95=${p(0.95).toFixed(3)} max=${p(1).toFixed(3)}`,
  );
  console.log(`  snapshot=${snapMs.toFixed(3)}ms (budget: 8ms/tick at 20Hz)`);
}

// Pheromones: update() at 256x256 x 2 layers with a busy field.
{
  const field = new PheromoneField({ worldSize: 2048, resolution: 256 });
  for (let i = 0; i < 20000; i++) {
    field.deposit(i % 2 ? 'food' : 'home', (i * 37) % 2048, (i * 91) % 2048, 0.5);
  }
  for (let i = 0; i < 20; i++) field.update();
  const n = 200;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) field.update();
  const upd = (performance.now() - t0) / n;
  const q0 = performance.now();
  const out = new Uint8Array(256 * 256 * 2);
  for (let i = 0; i < n; i++) field.quantize(out);
  const quant = (performance.now() - q0) / n;
  console.log(
    `pheromones 256x256x2: update=${upd.toFixed(3)}ms/tick quantize=${quant.toFixed(3)}ms/snapshot`,
  );
}
