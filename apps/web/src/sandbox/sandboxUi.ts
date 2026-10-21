import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import { Caste, PLAYER_COLONY, RED_COLONY } from '@ant/shared';
import type { Command, SandboxTuning, SimConfig, Snapshot } from '@ant/shared';
import { haptics } from '../platform/haptics';
import { h } from '../ui/dom';
import { mountParamsPanel } from './paramsPanel';
import type { ParamsPanel } from './paramsPanel';
import './sandbox.css';

export type Tool = 'food' | 'rock' | 'erase' | 'ants' | 'spider' | 'antlion';

const TOOLS: { tool: Tool; label: string; icon: string; hint: string }[] = [
  { tool: 'food', label: 'Food', icon: '🍯', hint: 'Tap or drag to drop food piles' },
  { tool: 'rock', label: 'Rocks', icon: '🪨', hint: 'Tap or drag to place rocks' },
  { tool: 'erase', label: 'Erase', icon: '🧽', hint: 'Drag over food, rocks, ants and hazards' },
  { tool: 'ants', label: 'Ants', icon: '🐜', hint: 'Tap or drag to spawn ants' },
  { tool: 'spider', label: 'Spider', icon: '🕷️', hint: 'Tap to release a spider' },
  { tool: 'antlion', label: 'Antlion', icon: '🌀', hint: 'Tap to dig an antlion pit' },
];

const CASTES = [
  { value: Caste.Worker, label: 'Workers' },
  { value: Caste.Soldier, label: 'Soldiers' },
  { value: Caste.Breeder, label: 'Breeders' },
] as const;

/** Pointer travel (px) that turns a tap into a drag. */
const TAP_SLOP = 8;
const FOOD_AMOUNT = 300;
const FOOD_SPACING = 36;
const ANT_SPACING = 26;
const ANTS_PER_STAMP = 4;
const MIN_BRUSH = 10;
const MAX_BRUSH = 90;

export interface SandboxUiOptions {
  host: HTMLElement;
  /** The surface world container: the brush cursor lives in it. */
  world: Container;
  /** Pan/zoom controller of the surface view (one-finger pan is off while a tool is armed). */
  camera: { oneFingerPan: boolean };
  send(commands: Command[]): void;
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  /** 0 = surface, 1 = nest view (tools only work on the surface). */
  layer(): 0 | 1;
  toast(text: string): void;
}

/**
 * Sandbox toolbar: a collapsible panel with a Pan / tool mode switch, paint tools (food,
 * rocks, erase, ants, spider, antlion), rain and scent buttons and the parameter panel.
 * Tool mode hands one-finger / left-button drags to the brush; two-finger pinch and the
 * wheel still move the camera, and "Pan" gives the drag back to the camera.
 */
export class SandboxUi {
  private active = false;
  private tool: Tool | null = null;
  private brush = 28;
  private antColony: number = PLAYER_COLONY;
  private antCaste: number = Caste.Worker;
  private colonies = 2;
  private raining = false;
  private collapsed = false;
  private cursor: Graphics | null = null;
  private readonly params: ParamsPanel;

  private readonly root = h('div', { id: 'sandbox', hidden: true });
  private readonly head = h('button', {
    type: 'button',
    id: 'sandbox-toggle',
    'aria-expanded': 'true',
    'aria-controls': 'sandbox-body',
  });
  private readonly body = h('div', { id: 'sandbox-body' });
  private readonly toolButtons = new Map<Tool | 'pan', HTMLButtonElement>();
  private readonly options = h('div', { class: 'sandbox-options' });
  private readonly hint = h('p', { class: 'sandbox-hint', role: 'status' });
  private readonly rainBtn = h('button', { type: 'button', id: 'sandbox-rain' }, 'Start rain');
  private readonly colonySel = h('select', { 'aria-label': 'Colony' });
  private readonly casteSel = h('select', { 'aria-label': 'Caste' });
  private readonly brushRow = h('label', { class: 'sandbox-row' }, h('span', {}, 'Brush size'));
  private readonly brushInput = h('input', {
    type: 'range',
    min: String(MIN_BRUSH),
    max: String(MAX_BRUSH),
    step: '2',
  });

  constructor(private readonly opts: SandboxUiOptions) {
    this.params = mountParamsPanel((cmds) => opts.send(cmds));
    this.build();
    document.body.append(this.root);
    this.bindPointer();
    // Rocks and paint conflict with the keyboard player controls only while typing; nothing to do.
  }

  /** Painting owns taps and one-finger drags (the camera and move-to taps stand down). */
  get toolMode(): boolean {
    return this.active && this.tool !== null;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** A sandbox game started or loaded (`config.sandbox`), or a normal game replaced it. */
  setGame(config: SimConfig, tuning?: SandboxTuning): void {
    this.active = config.sandbox;
    this.root.hidden = !config.sandbox;
    document.body.classList.toggle('sandbox', config.sandbox);
    this.colonies = config.colonies;
    this.raining = false;
    this.setTool(null);
    this.params.close();
    if (!config.sandbox) return;
    this.params.load(config, tuning);
    this.antColony = PLAYER_COLONY;
    this.colonySel.value = String(PLAYER_COLONY);
    this.colonySel.options[RED_COLONY]!.hidden = config.colonies < 2;
    // Phones start with the toolbar tucked away so it doesn't hide the yard.
    this.setCollapsed(window.innerWidth < 700);
    this.syncRain();
  }

  /** A new surface scene exists: the old cursor was destroyed with the old world. */
  attachScene(): void {
    this.cursor = new Graphics();
    this.cursor.visible = false;
    this.opts.world.addChild(this.cursor);
  }

  onSnapshot(s: Snapshot): void {
    if (!this.active) return;
    if (s.weather.raining !== this.raining) {
      this.raining = s.weather.raining;
      this.syncRain();
    }
  }

  private syncRain(): void {
    this.rainBtn.textContent = this.raining ? 'Stop rain' : 'Start rain';
    this.rainBtn.setAttribute('aria-pressed', String(this.raining));
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.body.hidden = collapsed;
    this.head.setAttribute('aria-expanded', String(!collapsed));
    this.syncHead();
  }

  private syncHead(): void {
    const t = TOOLS.find((k) => k.tool === this.tool);
    this.head.textContent = `${this.collapsed ? '▸' : '▾'} Sandbox${t ? ` · ${t.label}` : ''}`;
  }

  private setTool(tool: Tool | null): void {
    this.tool = tool;
    this.opts.camera.oneFingerPan = tool === null;
    for (const [key, b] of this.toolButtons) {
      b.setAttribute('aria-pressed', String(key === (tool ?? 'pan')));
    }
    const entry = TOOLS.find((k) => k.tool === tool);
    this.hint.textContent = entry ? entry.hint : 'Drag to pan, pinch or wheel to zoom';
    this.options.dataset.tool = tool ?? '';
    this.brushRow.hidden = tool !== 'rock' && tool !== 'erase';
    this.options.querySelector<HTMLElement>('.sandbox-ants')!.hidden = tool !== 'ants';
    this.syncHead();
    if (this.cursor) this.cursor.visible = false;
  }

  private build(): void {
    const { opts } = this;
    const modes = h('div', { class: 'sandbox-tools', role: 'group', 'aria-label': 'Tools' });
    const pan = h('button', { type: 'button', 'data-tool': 'pan' }, '✋ Pan');
    pan.addEventListener('click', () => this.setTool(null));
    this.toolButtons.set('pan', pan);
    modes.append(pan);
    for (const { tool, label, icon } of TOOLS) {
      const b = h('button', { type: 'button', 'data-tool': tool }, `${icon} ${label}`);
      b.addEventListener('click', () => this.setTool(this.tool === tool ? null : tool));
      this.toolButtons.set(tool, b);
      modes.append(b);
    }

    // Ants: which colony and caste.
    this.colonySel.append(
      h('option', { value: String(PLAYER_COLONY) }, 'Black'),
      h('option', { value: String(RED_COLONY) }, 'Red'),
    );
    for (const c of CASTES) this.casteSel.append(h('option', { value: String(c.value) }, c.label));
    this.colonySel.addEventListener(
      'change',
      () => (this.antColony = Number(this.colonySel.value)),
    );
    this.casteSel.addEventListener('change', () => (this.antCaste = Number(this.casteSel.value)));
    const ants = h('div', { class: 'sandbox-ants', hidden: true }, this.colonySel, this.casteSel);

    this.brushInput.value = String(this.brush);
    const brushOut = h('output', {}, String(this.brush));
    this.brushInput.addEventListener('input', () => {
      this.brush = Number(this.brushInput.value);
      brushOut.textContent = String(this.brush);
    });
    this.brushRow.append(this.brushInput, brushOut);
    this.brushRow.hidden = true;
    this.options.append(ants, this.brushRow);

    const actions = h('div', { class: 'sandbox-actions' });
    const act = (label: string, run: () => void, el?: HTMLButtonElement): HTMLButtonElement => {
      const b = el ?? h('button', { type: 'button' }, label);
      b.addEventListener('click', run);
      actions.append(b);
      return b;
    };
    act(
      '',
      () => opts.send([this.raining ? { type: 'stopRain' } : { type: 'startRain' }]),
      this.rainBtn,
    );
    act('Clear scent', () => {
      opts.send([{ type: 'clearPheromones' }]);
      opts.toast('Pheromones cleared');
    });
    act('Clear rocks', () => opts.send([{ type: 'clearObstacles' }]));
    const tune = act('⚙ Parameters', () => this.params.toggle());
    tune.id = 'sandbox-tune';

    this.head.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.body.append(modes, this.options, this.hint, actions);
    this.root.append(this.head, this.body);
    this.setTool(null);
  }

  /** World radius of the brush for the current tool (what the cursor ring shows). */
  private radius(): number {
    switch (this.tool) {
      case 'rock':
      case 'erase':
        return this.brush;
      case 'antlion':
        return 40;
      case 'ants':
        return 22;
      default:
        return 10;
    }
  }

  private moveCursor(x: number, y: number): void {
    const c = this.cursor;
    if (!c) return;
    const erase = this.tool === 'erase';
    c.clear()
      .circle(0, 0, this.radius())
      .fill({ color: erase ? 0xff6a4a : 0xffffff, alpha: 0.12 })
      .stroke({ color: erase ? 0xff6a4a : 0xffffff, width: 2, alpha: 0.8 });
    c.position.set(x, y);
    c.visible = true;
  }

  private stampCommands(tool: Tool, x: number, y: number, first: boolean): Command[] {
    switch (tool) {
      case 'food':
        return [{ type: 'placeFood', x, y, amount: FOOD_AMOUNT }];
      case 'rock':
        return [{ type: 'placeObstacle', x, y, radius: this.brush }];
      case 'erase':
        return [{ type: 'erase', x, y, radius: this.brush }];
      case 'ants':
        return [
          {
            type: 'spawnAnts',
            count: first ? ANTS_PER_STAMP * 2 : ANTS_PER_STAMP,
            x,
            y,
            colony: Math.min(this.antColony, this.colonies - 1),
            caste: this.antCaste as Caste,
          },
        ];
      default:
        return [];
    }
  }

  /** Spacing (world units) between brush stamps while dragging. */
  private spacing(tool: Tool): number {
    switch (tool) {
      case 'food':
        return FOOD_SPACING;
      case 'rock':
        return Math.max(12, this.brush * 0.9);
      case 'erase':
        return Math.max(8, this.brush * 0.5);
      default:
        return ANT_SPACING;
    }
  }

  private bindPointer(): void {
    const { host } = this.opts;
    const pointers = new Set<number>();
    let painting = -1;
    let start = { x: 0, y: 0 };
    let last = { x: 0, y: 0 };
    let dragged = false;

    const stampAlong = (wx: number, wy: number): void => {
      const tool = this.tool;
      if (!tool) return;
      const gap = this.spacing(tool);
      const dist = Math.hypot(wx - last.x, wy - last.y);
      if (dist < gap) return;
      // Fill the gap so a fast swipe leaves a continuous line, capped per event.
      const n = Math.min(12, Math.floor(dist / gap));
      const cmds: Command[] = [];
      for (let k = 1; k <= n; k++) {
        const t = (k * gap) / dist;
        cmds.push(
          ...this.stampCommands(
            tool,
            last.x + (wx - last.x) * t,
            last.y + (wy - last.y) * t,
            false,
          ),
        );
      }
      last = {
        x: last.x + ((wx - last.x) * (n * gap)) / dist,
        y: last.y + ((wy - last.y) * (n * gap)) / dist,
      };
      if (cmds.length) this.opts.send(cmds);
    };

    host.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      // A second finger is a pinch: stop painting.
      if (pointers.size > 1) {
        painting = -1;
        return;
      }
      if (!this.toolMode || this.opts.layer() !== 0) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      painting = e.pointerId;
      dragged = false;
      start = { x: e.clientX, y: e.clientY };
      const p = this.opts.toWorld(e.clientX, e.clientY);
      last = p;
      this.moveCursor(p.x, p.y);
      const tool = this.tool!;
      if (tool !== 'spider' && tool !== 'antlion') {
        this.opts.send(this.stampCommands(tool, p.x, p.y, true));
        haptics.light();
      }
    });
    host.addEventListener('pointermove', (e) => {
      if (!this.toolMode || this.opts.layer() !== 0) {
        if (this.cursor) this.cursor.visible = false;
        return;
      }
      if (e.pointerType === 'mouse' || e.pointerId === painting) {
        const p = this.opts.toWorld(e.clientX, e.clientY);
        this.moveCursor(p.x, p.y);
      }
      if (e.pointerId !== painting) return;
      if (!dragged && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP)
        dragged = true;
      if (dragged) {
        const p = this.opts.toWorld(e.clientX, e.clientY);
        stampAlong(p.x, p.y);
      }
    });
    const up = (e: PointerEvent, cancelled: boolean): void => {
      pointers.delete(e.pointerId);
      if (e.pointerId !== painting) return;
      painting = -1;
      if (this.cursor && e.pointerType !== 'mouse') this.cursor.visible = false;
      const tool = this.tool;
      if (cancelled || dragged || !tool) return;
      // One-shot tools act where the finger lifted.
      const p = this.opts.toWorld(e.clientX, e.clientY);
      if (tool === 'spider') {
        this.opts.send([{ type: 'spawnSpider', x: p.x, y: p.y }]);
        haptics.light();
      } else if (tool === 'antlion') {
        this.opts.send([{ type: 'addAntlion', x: p.x, y: p.y }]);
        haptics.light();
      }
    };
    host.addEventListener('pointerup', (e) => up(e, false));
    host.addEventListener('pointercancel', (e) => up(e, true));
    host.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && this.cursor) this.cursor.visible = false;
    });
  }
}
