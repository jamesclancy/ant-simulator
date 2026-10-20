import { createSim } from '@ant/sim';

const ants = Number(process.argv[2] ?? 5000);
const ticks = Number(process.argv[3] ?? 400);
const warmup = 50;

const sim = createSim({ seed: 1, initialAnts: ants, worldSize: 2048 });
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

console.log(`ants=${sim.ants.count} ticks=${ticks}`);
console.log(
  `ms/tick mean=${mean.toFixed(3)} p50=${p(0.5).toFixed(3)} p95=${p(0.95).toFixed(3)} max=${p(1).toFixed(3)}`,
);
console.log(`snapshot=${snapMs.toFixed(3)}ms (budget: 8ms/tick at 20Hz)`);
