import type { AntBehaviorConfig } from '@ant/shared';
import type { SimClient } from './simClient';
import './tuningPanel.css';

type NumericKey = {
  [K in keyof AntBehaviorConfig]: AntBehaviorConfig[K] extends number ? K : never;
}[keyof AntBehaviorConfig];

/** Slider ranges for each numeric behaviour knob. */
const SLIDERS: { key: NumericKey; min: number; max: number; step: number }[] = [
  { key: 'speed', min: 5, max: 120, step: 1 },
  { key: 'carrySpeedFactor', min: 0.2, max: 1.5, step: 0.05 },
  { key: 'sensorAngle', min: 0.1, max: 1.5, step: 0.05 },
  { key: 'sensorDistance', min: 4, max: 80, step: 1 },
  { key: 'turnRate', min: 0, max: 1.2, step: 0.01 },
  { key: 'jitter', min: 0, max: 1, step: 0.01 },
  { key: 'trailThreshold', min: 0, max: 0.05, step: 0.0005 },
  { key: 'depositHome', min: 0, max: 0.3, step: 0.005 },
  { key: 'depositFood', min: 0, max: 0.3, step: 0.005 },
  { key: 'depositDecay', min: 0.98, max: 1, step: 0.0005 },
  { key: 'foodSenseRadius', min: 0, max: 120, step: 1 },
  { key: 'nestSenseRadius', min: 0, max: 200, step: 1 },
  { key: 'homingBias', min: 0, max: 0.3, step: 0.005 },
];

/**
 * Dev-only panel (enabled with `?debug`) for live-tuning ant behaviour. Every change is sent
 * as a `setBehavior` command, so tuning stays deterministic and replayable.
 */
export function mountTuningPanel(sim: SimClient, initial: AntBehaviorConfig): HTMLElement {
  const panel = document.createElement('details');
  panel.className = 'tuning';
  // Open on wide screens; on phones it would cover the game.
  panel.open = window.innerWidth > 600;
  const summary = document.createElement('summary');
  summary.textContent = 'Behaviour';
  panel.appendChild(summary);

  for (const { key, min, max, step } of SLIDERS) {
    const row = document.createElement('label');
    const name = document.createElement('span');
    name.textContent = key;
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', min, max, step, value: String(initial[key]) });
    const out = document.createElement('output');
    out.textContent = String(initial[key]);
    input.addEventListener('input', () => {
      const value = Number(input.value);
      out.textContent = input.value;
      sim.sendCommands([{ type: 'setBehavior', params: { [key]: value } }]);
    });
    row.append(name, input, out);
    panel.appendChild(row);
  }

  const toggle = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = 'pheromones';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = initial.pheromones;
  box.addEventListener('change', () => {
    sim.sendCommands([{ type: 'setBehavior', params: { pheromones: box.checked } }]);
  });
  toggle.append(name, box);
  panel.appendChild(toggle);

  document.body.appendChild(panel);
  return panel;
}
