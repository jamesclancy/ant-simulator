import type { Command, Snapshot } from '@ant/shared';
import './nest.css';

type Key = 'forage' | 'dig' | 'nurse';
const KEYS: Key[] = ['forage', 'dig', 'nurse'];
const LABELS: Record<Key, string> = { forage: 'Forage', dig: 'Dig', nurse: 'Nurse' };

/**
 * Collapsible colony panel: population / brood / food readout and three linked sliders
 * (forage / dig / nurse) that always sum to 100%. Moving one rescales the others in
 * proportion and sends `setBehaviorRatio`.
 */
export class ColonyPanel {
  private el = document.createElement('details');
  private readout = document.createElement('div');
  private sliders = new Map<Key, { input: HTMLInputElement; value: HTMLSpanElement }>();
  private values: Record<Key, number> = { forage: 60, dig: 20, nurse: 20 };
  private synced = false;

  constructor(
    parent: HTMLElement,
    private send: (cmds: Command[]) => void,
  ) {
    this.el.id = 'colony-panel';
    const summary = document.createElement('summary');
    summary.textContent = 'Colony';
    this.readout.className = 'colony-readout';
    this.el.append(summary, this.readout);
    for (const k of KEYS) {
      const row = document.createElement('label');
      row.className = 'colony-row';
      const name = document.createElement('span');
      name.textContent = LABELS[k];
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.step = '1';
      input.value = String(this.values[k]);
      input.setAttribute('aria-label', `${LABELS[k]} share`);
      const value = document.createElement('span');
      value.className = 'colony-value';
      input.addEventListener('input', () => this.onInput(k, Number(input.value)));
      row.append(name, input, value);
      this.el.appendChild(row);
      this.sliders.set(k, { input, value });
    }
    parent.appendChild(this.el);
    this.render();
  }

  private onInput(changed: Key, v: number): void {
    const others = KEYS.filter((k) => k !== changed);
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
    this.send([
      {
        type: 'setBehaviorRatio',
        forage: this.values.forage,
        dig: this.values.dig,
        nurse: this.values.nurse,
      },
    ]);
  }

  private render(): void {
    for (const k of KEYS) {
      const s = this.sliders.get(k)!;
      s.input.value = String(this.values[k]);
      s.value.textContent = `${this.values[k]}%`;
    }
  }

  update(snapshot: Snapshot): void {
    const c = snapshot.colony;
    if (!this.synced) {
      this.synced = true;
      for (const k of KEYS) this.values[k] = Math.round(c.ratio[k] * 100);
      this.render();
    }
    const status = c.lost
      ? 'Queen dead — colony lost'
      : c.queenAlive
        ? 'Queen healthy'
        : 'Queen dead';
    this.readout.textContent =
      `${status}\nAnts ${c.population} (${c.underground} below) · food ${Math.floor(snapshot.colonyFood)}\n` +
      `Eggs ${c.eggs} · larvae ${c.larvae} · pupae ${c.pupae} (room ${c.broodCapacity})`;
  }
}
