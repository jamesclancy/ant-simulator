import { PLAYER_COLONY, RED_COLONY } from '@ant/shared';
import type { Command, Snapshot } from '@ant/shared';
import './nest.css';

/**
 * Three linked sliders that always sum to 100%: moving one rescales the other two in
 * proportion. `onChange` gets the new percentages.
 */
class LinkedSliders<K extends string> {
  readonly el = document.createElement('fieldset');
  private sliders = new Map<K, { input: HTMLInputElement; value: HTMLSpanElement }>();
  values: Record<K, number>;

  constructor(
    title: string,
    private keys: readonly K[],
    private labels: Record<K, string>,
    initial: Record<K, number>,
    private onChange: (values: Record<K, number>) => void,
  ) {
    this.values = { ...initial };
    const legend = document.createElement('legend');
    legend.textContent = title;
    this.el.className = 'colony-group';
    this.el.appendChild(legend);
    for (const k of keys) {
      const row = document.createElement('label');
      row.className = 'colony-row';
      const name = document.createElement('span');
      name.textContent = labels[k];
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.setAttribute('aria-label', `${labels[k]} share`);
      const value = document.createElement('span');
      value.className = 'colony-value';
      input.addEventListener('input', () => this.onInput(k, Number(input.value)));
      row.append(name, input, value);
      this.el.appendChild(row);
      this.sliders.set(k, { input, value });
    }
    this.render();
  }

  /** Show fractions (0..1) from the sim. */
  set(fractions: Record<K, number>): void {
    for (const k of this.keys) this.values[k] = Math.round(fractions[k] * 100);
    this.render();
  }

  private onInput(changed: K, v: number): void {
    const others = this.keys.filter((k) => k !== changed);
    const rest = 100 - v;
    const otherSum = others.reduce((s, k) => s + this.values[k], 0);
    this.values[changed] = v;
    let used = 0;
    others.forEach((k, idx) => {
      const share =
        idx === others.length - 1
          ? rest - used
          : Math.round(otherSum > 0 ? (this.values[k] / otherSum) * rest : rest / others.length);
      this.values[k] = share;
      used += share;
    });
    this.render();
    this.onChange(this.values);
  }

  private render(): void {
    for (const k of this.keys) {
      const s = this.sliders.get(k)!;
      s.input.value = String(this.values[k]);
      s.value.textContent = `${this.values[k]}%`;
    }
  }
}

type Job = 'forage' | 'dig' | 'nurse';
type CasteKey = 'worker' | 'soldier' | 'breeder';

/**
 * Collapsible colony panel for the player's (black) colony: population / brood / food
 * readout, the forage/dig/nurse behaviour sliders, the worker/soldier/breeder caste sliders,
 * and a raid toggle that sends soldiers against the red nest.
 */
export class ColonyPanel {
  private el = document.createElement('details');
  private readout = document.createElement('div');
  private jobs: LinkedSliders<Job>;
  private castes: LinkedSliders<CasteKey>;
  private raid = document.createElement('input');
  private synced = false;

  constructor(
    parent: HTMLElement,
    private send: (cmds: Command[]) => void,
  ) {
    this.el.id = 'colony-panel';
    const summary = document.createElement('summary');
    summary.textContent = 'Colony';
    this.readout.className = 'colony-readout';
    this.jobs = new LinkedSliders<Job>(
      'Jobs (workers)',
      ['forage', 'dig', 'nurse'],
      { forage: 'Forage', dig: 'Dig', nurse: 'Nurse' },
      { forage: 60, dig: 20, nurse: 20 },
      (v) => this.send([{ type: 'setBehaviorRatio', colony: PLAYER_COLONY, ...v }]),
    );
    this.castes = new LinkedSliders<CasteKey>(
      'New ants (caste)',
      ['worker', 'soldier', 'breeder'],
      { worker: 'Worker', soldier: 'Soldier', breeder: 'Breeder' },
      { worker: 85, soldier: 15, breeder: 0 },
      (v) => this.send([{ type: 'setCasteRatio', colony: PLAYER_COLONY, ...v }]),
    );
    const raidRow = document.createElement('label');
    raidRow.className = 'colony-raid';
    this.raid.type = 'checkbox';
    this.raid.addEventListener('change', () =>
      this.send([{ type: 'setRaid', colony: PLAYER_COLONY, on: this.raid.checked }]),
    );
    const raidText = document.createElement('span');
    raidText.textContent = 'Soldiers raid the red nest';
    raidRow.append(this.raid, raidText);
    this.el.append(summary, this.readout, this.jobs.el, this.castes.el, raidRow);
    parent.appendChild(this.el);
  }

  /** Forget sim-side values (new game): the next `update` re-reads them. */
  reset(): void {
    this.synced = false;
  }

  update(snapshot: Snapshot): void {
    const c = snapshot.colonies[PLAYER_COLONY];
    if (!c) return;
    if (!this.synced) {
      this.synced = true;
      this.jobs.set(c.ratio);
      this.castes.set(c.casteRatio);
      this.raid.checked = c.raid;
    }
    const status = c.lost
      ? 'Queen dead — colony lost'
      : c.intruders > 0
        ? `Queen under attack! ${c.intruders} red ants in the nest`
        : 'Queen healthy';
    const red = snapshot.colonies[RED_COLONY];
    const [w, s, b] = c.castes;
    this.readout.textContent =
      `${status} (${Math.ceil(c.queenHp)}/${c.queenMaxHp} HP)\n` +
      `Ants ${c.population} (${c.underground} below) · food ${Math.floor(c.food)}\n` +
      `Workers ${w} · soldiers ${s} · breeders ${b} · lost ${c.losses}\n` +
      `Eggs ${c.eggs} · larvae ${c.larvae} · pupae ${c.pupae} (room ${c.broodCapacity})` +
      (red ? `\nRed colony: ${red.population} ants · lost ${red.losses}` : '');
  }
}
