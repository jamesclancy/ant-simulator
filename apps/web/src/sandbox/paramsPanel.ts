import {
  DEFAULT_BEHAVIOR,
  DEFAULT_COLONY,
  DEFAULT_COMBAT,
  DEFAULT_PHEROMONE_LAYERS,
} from '@ant/shared';
import type {
  AntBehaviorConfig,
  ColonyConfig,
  Command,
  PheromoneType,
  SandboxTuning,
  SimConfig,
} from '@ant/shared';
import { h } from '../ui/dom';

/** One live-tunable number: where it lives in the sim and how its slider looks. */
interface Param {
  id: string;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  /** Value in the sim as configured at game start (or restored from a save). */
  initial(cfg: SimConfig, tuning: SandboxTuning | undefined): number;
  /** The shipped default, for "reset". */
  def: number;
  /** Command that applies `value`; `all` holds every current value (for array params). */
  command(value: number, all: Readonly<Record<string, number>>): Command;
}

type NumKey<T> = { [K in keyof T]: T[K] extends number ? K : never }[keyof T];

const behavior = (
  key: NumKey<AntBehaviorConfig>,
  label: string,
  min: number,
  max: number,
  step: number,
  hint?: string,
): Param => ({
  id: `behavior.${key}`,
  label,
  ...(hint ? { hint } : {}),
  min,
  max,
  step,
  initial: (cfg) => cfg.behavior[key],
  def: DEFAULT_BEHAVIOR[key],
  command: (value) => ({ type: 'setBehavior', params: { [key]: value } }),
});

const colony = (
  key: NumKey<Omit<ColonyConfig, 'behaviorRatio' | 'casteRatio'>>,
  label: string,
  min: number,
  max: number,
  step: number,
  hint?: string,
): Param => ({
  id: `colony.${key}`,
  label,
  ...(hint ? { hint } : {}),
  min,
  max,
  step,
  initial: (cfg, tuning) => tuning?.colonies[0]?.[key] ?? cfg.colony[key],
  def: DEFAULT_COLONY[key],
  command: (value) => ({ type: 'setColonyParams', params: { [key]: value } }),
});

const pheromone = (
  type: PheromoneType,
  key: 'evaporation' | 'diffusion',
  label: string,
  min: number,
  max: number,
  step: number,
): Param => ({
  id: `scent.${type}.${key}`,
  label,
  min,
  max,
  step,
  initial: (_cfg, tuning) => tuning?.pheromones[type]?.[key] ?? DEFAULT_PHEROMONE_LAYERS[type][key],
  def: DEFAULT_PHEROMONE_LAYERS[type][key],
  command: (value) => ({ type: 'setPheromoneParams', pheromone: type, params: { [key]: value } }),
});

/** Combat tables are arrays in the sim: send the whole row built from the current slider values. */
const combatCaste = (
  table: 'hp' | 'damage',
  caste: 0 | 1,
  label: string,
  min: number,
  max: number,
  step: number,
): Param => ({
  id: `combat.${table}.${caste}`,
  label,
  min,
  max,
  step,
  initial: (cfg) => cfg.combat[table][caste],
  def: DEFAULT_COMBAT[table][caste],
  command: (value, all) => ({
    type: 'setCombat',
    params: {
      [table]: [0, 1, 2].map((k) =>
        k === caste ? value : (all[`combat.${table}.${k}`] ?? DEFAULT_COMBAT[table][k]!),
      ),
    },
  }),
});

const combat = (
  key: 'contactRange' | 'soldierEngageRange' | 'workerEngageRange' | 'alarmDeposit',
  label: string,
  min: number,
  max: number,
  step: number,
): Param => ({
  id: `combat.${key}`,
  label,
  min,
  max,
  step,
  initial: (cfg) => cfg.combat[key],
  def: DEFAULT_COMBAT[key],
  command: (value) => ({ type: 'setCombat', params: { [key]: value } }),
});

interface Section {
  title: string;
  /** Shown under the title. */
  note?: string;
  params: Param[];
}

const SECTIONS: Section[] = [
  {
    title: 'Movement',
    params: [
      behavior('speed', 'Walking speed', 5, 120, 1),
      behavior('carrySpeedFactor', 'Speed when carrying', 0.2, 1.5, 0.05),
      behavior('turnRate', 'Turn rate', 0, 1.2, 0.01),
      behavior('jitter', 'Wobble', 0, 1, 0.01),
    ],
  },
  {
    title: 'Senses',
    params: [
      behavior('sensorAngle', 'Sensor angle', 0.1, 1.5, 0.05),
      behavior('sensorDistance', 'Sensor reach', 4, 80, 1),
      behavior('trailThreshold', 'Trail threshold', 0, 0.05, 0.0005),
      behavior('foodSenseRadius', 'Food sense radius', 0, 120, 1),
      behavior('nestSenseRadius', 'Nest sense radius', 0, 200, 1),
      behavior('homingBias', 'Homing pull', 0, 0.3, 0.005),
    ],
  },
  {
    title: 'Scent',
    note: 'Applies to every colony.',
    params: [
      behavior('depositHome', 'Home trail deposit', 0, 0.3, 0.005),
      behavior('depositFood', 'Food trail deposit', 0, 0.3, 0.005),
      behavior('depositDecay', 'Deposit fade', 0.98, 1, 0.0005),
      pheromone('food', 'evaporation', 'Food trail evaporation', 0, 0.1, 0.001),
      pheromone('home', 'evaporation', 'Home trail evaporation', 0, 0.1, 0.001),
      pheromone('alarm', 'evaporation', 'Alarm evaporation', 0, 0.2, 0.001),
      pheromone('food', 'diffusion', 'Food trail spread', 0, 0.5, 0.005),
      pheromone('home', 'diffusion', 'Home trail spread', 0, 0.5, 0.005),
    ],
  },
  {
    title: 'Combat',
    params: [
      combatCaste('hp', 0, 'Worker HP', 1, 100, 1),
      combatCaste('hp', 1, 'Soldier HP', 1, 200, 1),
      combatCaste('damage', 0, 'Worker damage', 0, 2, 0.01),
      combatCaste('damage', 1, 'Soldier damage', 0, 2, 0.01),
      combat('contactRange', 'Contact range', 2, 30, 1),
      combat('workerEngageRange', 'Worker engage range', 0, 80, 1),
      combat('soldierEngageRange', 'Soldier engage range', 0, 120, 1),
      combat('alarmDeposit', 'Alarm strength', 0, 1, 0.01),
    ],
  },
  {
    title: 'Brood & economy',
    note: 'Applies to every colony. Times are in ticks (20 per second).',
    params: [
      colony('maxLayRate', 'Max egg rate', 0, 0.2, 0.001),
      colony('eggCost', 'Food per egg', 0, 10, 0.1),
      colony('eggTicks', 'Egg time', 20, 1200, 10),
      colony('larvaTicks', 'Larva time', 20, 1600, 10),
      colony('pupaTicks', 'Pupa time', 20, 1600, 10),
      colony('larvaFeedRate', 'Larva appetite', 0, 0.02, 0.0005),
      colony('nurseBoost', 'Nursing boost', 0, 4, 0.1),
      colony('upkeepPerAnt', 'Food upkeep per ant', 0, 0.002, 0.00005),
    ],
  },
];

function decimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

export interface ParamsPanel {
  readonly el: HTMLElement;
  /** Refill the sliders from a freshly started or loaded game. */
  load(cfg: SimConfig, tuning: SandboxTuning | undefined): void;
  open(): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

/**
 * Sandbox-only panel: sliders for ant behaviour, scent, combat and brood rates. Every change
 * is sent as a command (so it is deterministic and saved); "Reset to defaults" restores the
 * shipped values for everything in the panel.
 */
export function mountParamsPanel(send: (commands: Command[]) => void): ParamsPanel {
  const el = h('section', {
    id: 'sandbox-params',
    class: 'sandbox-panel',
    role: 'dialog',
    'aria-label': 'Simulation parameters',
    hidden: true,
  });
  const values: Record<string, number> = {};
  const rows = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; p: Param }>();
  const pheromones = h('input', { type: 'checkbox', id: 'sbp-pheromones' });
  pheromones.checked = DEFAULT_BEHAVIOR.pheromones;
  pheromones.addEventListener('change', () =>
    send([{ type: 'setBehavior', params: { pheromones: pheromones.checked } }]),
  );

  const show = (p: Param): void => {
    const row = rows.get(p.id)!;
    const v = values[p.id]!;
    row.input.value = String(v);
    row.out.textContent = v.toFixed(decimals(p.step));
    row.input.setAttribute('aria-valuetext', row.out.textContent);
  };

  const body = h('div', { class: 'sandbox-scroll' });
  body.append(
    h(
      'label',
      { class: 'sandbox-row sandbox-check', for: 'sbp-pheromones' },
      h('span', {}, 'Ants use pheromones'),
      pheromones,
    ),
  );
  for (const section of SECTIONS) {
    const d = h('details', { class: 'sandbox-section', open: true });
    d.append(h('summary', {}, section.title));
    if (section.note) d.append(h('p', { class: 'sandbox-note' }, section.note));
    for (const p of section.params) {
      const id = `sbp-${p.id.replace(/\./g, '-')}`;
      const input = h('input', {
        id,
        type: 'range',
        min: String(p.min),
        max: String(p.max),
        step: String(p.step),
      });
      const out = h('output', { for: id });
      input.addEventListener('input', () => {
        values[p.id] = Number(input.value);
        show(p);
        send([p.command(values[p.id]!, values)]);
      });
      rows.set(p.id, { input, out, p });
      values[p.id] = p.def;
      d.append(h('label', { class: 'sandbox-row', for: id }, h('span', {}, p.label), input, out));
    }
    body.append(d);
  }

  const close = h('button', { type: 'button', class: 'sandbox-x', 'aria-label': 'Close' }, '✕');
  const reset = h('button', { type: 'button', class: 'secondary' }, 'Reset to defaults');
  close.addEventListener('click', () => api.close());
  reset.addEventListener('click', () => {
    const cmds: Command[] = [
      { type: 'setBehavior', params: { ...DEFAULT_BEHAVIOR } },
      {
        type: 'setCombat',
        params: {
          ...DEFAULT_COMBAT,
          hp: [...DEFAULT_COMBAT.hp],
          damage: [...DEFAULT_COMBAT.damage],
        },
      },
    ];
    for (const { p } of rows.values()) {
      values[p.id] = p.def;
      show(p);
      if (p.id.startsWith('colony.') || p.id.startsWith('scent.')) {
        cmds.push(p.command(p.def, values));
      }
    }
    pheromones.checked = DEFAULT_BEHAVIOR.pheromones;
    send(cmds);
  });
  el.append(h('header', {}, h('h2', {}, 'Parameters'), reset, close), body);
  document.body.append(el);

  /** The joystick would sit on top of the phone bottom sheet, so it steps aside. */
  const setOpen = (open: boolean): void => {
    el.hidden = !open;
    document.body.classList.toggle('params-open', open);
  };

  const api: ParamsPanel = {
    el,
    load(cfg, tuning) {
      for (const { p } of rows.values()) {
        values[p.id] = p.initial(cfg, tuning);
        show(p);
      }
      pheromones.checked = cfg.behavior.pheromones;
    },
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(el.hidden === true),
    get isOpen() {
      return !el.hidden;
    },
  };
  return api;
}
