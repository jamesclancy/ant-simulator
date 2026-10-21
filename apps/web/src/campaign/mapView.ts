import type { CampaignSnapshot, PatchInfo, WeatherInfo } from '@ant/shared';
import { h, focusables, trapFocus } from '../ui/dom';

/** "Yard C4" for yard patches, the room name in the house. */
export function patchName(p: Pick<PatchInfo, 'kind' | 'name' | 'col' | 'row'>): string {
  return p.kind === 'room' ? p.name : `Yard ${String.fromCharCode(65 + p.col)}${p.row + 1}`;
}

/** Map cell class by who holds the patch (styled in campaign.css). */
function ownerClass(p: PatchInfo): string {
  if (p.black && p.red) return 'contested';
  if (p.black) return 'own-black';
  if (p.red) return 'own-red';
  return 'empty';
}

export interface MapViewOptions {
  /** Tap on a patch with a black colony. */
  onEnter(patch: number): void;
  onFlight(): void;
  onClose(): void;
}

/**
 * Yard map overlay: the yard grid with the house rooms above it, coloured by ownership, with
 * ant counts per patch, the season, weather in the current patch and the house infestation
 * meter. Patches with a black colony can be entered. DOM (not Pixi), like the menus.
 */
export class MapView {
  readonly root = h('div', { id: 'campaign-map', hidden: true });
  private card = h('div', {
    class: 'cmap-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'cmap-title',
  });
  private status = h('p', { class: 'cmap-status', 'aria-live': 'polite' });
  private meter = h('div', { class: 'cmap-meter', role: 'meter', 'aria-label': 'Infestation' });
  private meterFill = h('div', { class: 'cmap-meter-fill' });
  private meterText = h('span', { class: 'cmap-meter-text' });
  private grid = h('div', { class: 'cmap-grid', role: 'grid', 'aria-label': 'Yard map' });
  private flight = h('button', { type: 'button', class: 'cmap-flight' }, 'Mating flight');
  private cells = new Map<number, HTMLButtonElement>();
  private last: CampaignSnapshot | null = null;
  private weather: WeatherInfo | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor(private opts: MapViewOptions) {
    const close = h('button', { type: 'button', class: 'cmap-close' }, 'Back to patch');
    close.addEventListener('click', () => opts.onClose());
    this.flight.addEventListener('click', () => opts.onFlight());
    this.meter.append(this.meterFill, this.meterText);
    this.card.append(
      h(
        'header',
        { class: 'cmap-head' },
        h('h2', { id: 'cmap-title' }, 'Yard map'),
        this.status,
        this.meter,
      ),
      this.grid,
      h('div', { class: 'cmap-actions' }, this.flight, close),
    );
    this.root.append(this.card);
    document.body.append(this.root);
    trapFocus(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.root.hidden = false;
    this.render();
    (this.cells.get(this.last?.active ?? -1) ?? focusables(this.card)[0])?.focus();
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.returnFocus?.focus?.();
    this.returnFocus = null;
  }

  update(c: CampaignSnapshot, weather?: WeatherInfo): void {
    this.last = c;
    if (weather) this.weather = weather;
    if (this.isOpen) this.render();
  }

  private render(): void {
    const c = this.last;
    if (!c) return;
    if (this.cells.size !== c.patches.length) this.build(c);
    for (const p of c.patches) {
      const b = this.cells.get(p.id)!;
      b.className = `cmap-cell ${p.kind} ${ownerClass(p)}${p.id === c.active ? ' active' : ''}`;
      b.disabled = !p.black;
      const counts = b.querySelector('.cmap-counts')!;
      counts.replaceChildren(
        p.black ? h('span', { class: 'cmap-black' }, `${p.black}`) : '',
        p.red ? h('span', { class: 'cmap-red' }, `${p.red}`) : '',
      );
      b.setAttribute(
        'aria-label',
        `${patchName(p)}: ${p.black ? `${p.black} black ants` : 'no black colony'}` +
          `${p.red ? `, ${p.red} red ants` : ''}${p.id === c.active ? ' (you are here)' : ''}`,
      );
    }
    const rain = this.weather?.raining ? ' · raining here' : '';
    this.status.textContent =
      `Season ${c.season + 1} (${Math.round(c.seasonProgress * 100)}%) · ` +
      `black ${c.owned} · red ${c.redOwned} patches · breeders ${c.breeders}${rain}`;
    const pct = Math.round(c.infestation * 100);
    this.meter.setAttribute('aria-valuenow', String(pct));
    this.meter.setAttribute('aria-valuemin', '0');
    this.meter.setAttribute('aria-valuemax', '100');
    this.meterFill.style.width = `${pct}%`;
    this.meterText.textContent = `House infestation ${pct}% · ${c.indoor}/${c.indoorTarget} ants indoors`;
    this.flight.disabled = c.breeders < c.flightMin || c.outcome !== '';
    this.flight.textContent =
      c.breeders >= c.flightMin
        ? `Mating flight (${c.breeders})`
        : `Mating flight (${c.breeders}/${c.flightMin})`;
  }

  private build(c: CampaignSnapshot): void {
    this.grid.replaceChildren();
    this.cells.clear();
    const minRow = Math.min(...c.patches.map((p) => p.row));
    this.grid.style.setProperty('--cols', String(c.cols));
    for (const p of c.patches) {
      const b = h(
        'button',
        { type: 'button', 'data-patch': String(p.id) },
        h('span', { class: 'cmap-name' }, p.kind === 'room' ? p.name : ''),
        h('span', { class: 'cmap-counts' }),
      );
      b.style.gridColumn = String(p.col + 1);
      b.style.gridRow = String(p.row - minRow + 1);
      b.addEventListener('click', () => this.opts.onEnter(p.id));
      this.cells.set(p.id, b);
      this.grid.append(b);
    }
  }
}
