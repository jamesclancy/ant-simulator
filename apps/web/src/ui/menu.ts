import type { Difficulty } from '@ant/shared';
import { h, focusables, trapFocus } from './dom';
import { DEFAULT_SANDBOX, type SandboxOptions } from '../sandbox/config';
import {
  UI_SCALE_MAX,
  UI_SCALE_MIN,
  type JoystickMode,
  type JoystickSide,
  type Settings,
  type SettingsStore,
} from './settings';
import './ui.css';

export type { SandboxOptions };

export interface NewGameOptions {
  difficulty: Difficulty;
  /** Undefined = pick a random seed. */
  seed: number | undefined;
  tutorial: boolean;
  /** Present for a sandbox game. */
  sandbox?: SandboxOptions;
}

export interface MenuOptions {
  settings: SettingsStore;
  difficulty: Difficulty;
  onNewGame(options: NewGameOptions): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onReplayTutorial(): void;
}

type Screen = 'main' | 'newGame' | 'sandbox' | 'settings' | 'howTo' | 'pause';

/** Parse the seed field: blank = random; digits only, capped to a positive 31-bit int. */
export function parseSeed(text: string): number | undefined | null {
  const t = text.trim();
  if (t === '') return undefined;
  if (!/^\d{1,10}$/.test(t)) return null;
  const n = Number(t);
  return n > 0x7fffffff ? null : n;
}

const DIFFICULTIES: readonly { value: Difficulty; label: string; hint: string }[] = [
  { value: 'easy', label: 'Easy', hint: 'A sleepy red colony.' },
  { value: 'normal', label: 'Normal', hint: 'A fair fight.' },
  { value: 'hard', label: 'Hard', hint: 'Red raids early and often.' },
];

/**
 * Full-screen menu overlay: main menu, new game options, settings, how to play and the
 * in-game pause menu. One dialog at a time, focus-trapped, Esc / back goes up a level.
 */
export class Menu {
  readonly root = h('div', { id: 'menu', hidden: true });
  private panel = h('div', { class: 'menu-card', role: 'dialog', 'aria-modal': 'true' });
  private screens: Screen[] = [];
  private returnFocus: HTMLElement | null = null;
  private continueHandler: (() => void) | null = null;
  private difficulty: Difficulty;
  private settingsSync: (() => void) | null = null;
  /** Sandbox setup choices, kept while the menu lives. */
  private sandbox: SandboxOptions = { ...DEFAULT_SANDBOX };

  constructor(private opts: MenuOptions) {
    this.difficulty = opts.difficulty;
    this.root.append(this.panel);
    document.body.append(this.root);
    trapFocus(this.root);
    opts.settings.subscribe(() => this.settingsSync?.());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show or hide the Continue button (wired to the save system). */
  setContinue(handler: (() => void) | null): void {
    this.continueHandler = handler;
    if (this.isOpen && this.screens[this.screens.length - 1] === 'main') this.render();
  }

  showMain(): void {
    this.open('main');
  }

  showPause(): void {
    this.open('pause');
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    this.screens = [];
    this.settingsSync = null;
    this.returnFocus?.focus?.();
    this.returnFocus = null;
  }

  /**
   * Esc / Android back: go up a level, or resume from the pause menu.
   * Returns false when there is nothing to go back to (the main menu).
   */
  back(): boolean {
    if (!this.isOpen) return false;
    if (this.screens.length > 1) {
      this.screens.pop();
      this.render();
      return true;
    }
    if (this.screens[0] === 'pause') {
      this.opts.onResume();
      return true;
    }
    return false;
  }

  private open(screen: Screen): void {
    if (!this.isOpen) this.returnFocus = document.activeElement as HTMLElement | null;
    this.screens = [screen];
    this.root.hidden = false;
    this.render();
  }

  private push(screen: Screen): void {
    this.screens.push(screen);
    this.render();
  }

  private render(): void {
    const screen = this.screens[this.screens.length - 1]!;
    this.settingsSync = null;
    const body =
      screen === 'main'
        ? this.mainScreen()
        : screen === 'pause'
          ? this.pauseScreen()
          : screen === 'newGame'
            ? this.newGameScreen()
            : screen === 'sandbox'
              ? this.sandboxScreen()
              : screen === 'settings'
                ? this.settingsScreen()
                : this.howToScreen();
    this.panel.replaceChildren(...body.nodes);
    this.panel.setAttribute('aria-labelledby', 'menu-title');
    this.root.dataset.screen = screen;
    (body.focus ?? focusables(this.panel)[0])?.focus();
  }

  private title(text: string, subtitle?: string): HTMLElement {
    return h(
      'header',
      { class: 'menu-head' },
      h('h1', { id: 'menu-title' }, text),
      subtitle ? h('p', { class: 'menu-sub' }, subtitle) : null,
    );
  }

  private button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = h('button', { type: 'button', class: `menu-btn ${cls}`.trim() }, label);
    b.addEventListener('click', onClick);
    return b;
  }

  private backButton(label = 'Back'): HTMLButtonElement {
    return this.button(label, () => this.back(), 'secondary');
  }

  private mainScreen(): { nodes: Node[]; focus?: HTMLElement } {
    const newGame = this.button('New Game', () => this.push('newGame'), 'primary');
    const list = h('div', { class: 'menu-list' });
    if (this.continueHandler) {
      const handler = this.continueHandler;
      list.append(this.button('Continue', () => handler(), 'primary'));
    }
    list.append(
      newGame,
      this.button('Sandbox', () => this.push('sandbox')),
      this.button('Settings', () => this.push('settings')),
      this.button('How to Play', () => this.push('howTo')),
    );
    return {
      nodes: [this.title('Ant Simulator', 'Rule the yard. Defeat the red colony.'), list],
      focus: (list.firstElementChild as HTMLElement) ?? newGame,
    };
  }

  private pauseScreen(): { nodes: Node[]; focus?: HTMLElement } {
    const resume = this.button('Resume', () => this.opts.onResume(), 'primary');
    return {
      nodes: [
        this.title('Paused'),
        h(
          'div',
          { class: 'menu-list' },
          resume,
          this.button('Settings', () => this.push('settings')),
          this.button('How to Play', () => this.push('howTo')),
          this.button('Restart', () => this.opts.onRestart()),
          this.button('Quit to menu', () => this.opts.onQuit(), 'danger'),
        ),
      ],
      focus: resume,
    };
  }

  private newGameScreen(): { nodes: Node[]; focus?: HTMLElement } {
    const { settings } = this.opts;
    const group = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Difficulty' });
    const hint = h('p', { class: 'menu-hint', 'aria-live': 'polite' });
    const buttons = DIFFICULTIES.map((d) => {
      const b = h('button', { type: 'button', class: 'seg-btn' }, d.label);
      b.addEventListener('click', () => {
        this.difficulty = d.value;
        sync();
      });
      group.append(b);
      return { d, b };
    });
    const sync = (): void => {
      for (const { d, b } of buttons)
        b.setAttribute('aria-pressed', String(d.value === this.difficulty));
      hint.textContent = DIFFICULTIES.find((d) => d.value === this.difficulty)!.hint;
    };
    sync();
    const seed = h('input', {
      id: 'seed',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: 'Random',
      maxlength: '10',
      'aria-describedby': 'seed-help',
    });
    const seedHelp = h('p', { id: 'seed-help', class: 'menu-hint', role: 'status' });
    seed.addEventListener('input', () => {
      seedHelp.textContent = parseSeed(seed.value) === null ? 'Seed must be a whole number.' : '';
    });
    const tutorial = h('input', { id: 'tutorial-opt', type: 'checkbox' });
    tutorial.checked = !settings.value.tutorialSeen;
    const start = this.button(
      'Start',
      () => {
        const parsed = parseSeed(seed.value);
        if (parsed === null) {
          seedHelp.textContent = 'Seed must be a whole number.';
          seed.focus();
          return;
        }
        this.opts.onNewGame({
          difficulty: this.difficulty,
          seed: parsed,
          tutorial: tutorial.checked,
        });
      },
      'primary',
    );
    return {
      nodes: [
        this.title('New Game'),
        h(
          'div',
          { class: 'menu-form' },
          h('span', { class: 'menu-label', id: 'diff-label' }, 'Difficulty'),
          group,
          hint,
        ),
        h(
          'div',
          { class: 'menu-form' },
          h('label', { class: 'menu-label', for: 'seed' }, 'Seed'),
          seed,
          seedHelp,
        ),
        h(
          'label',
          { class: 'menu-check', for: 'tutorial-opt' },
          tutorial,
          h('span', {}, 'Show tutorial'),
        ),
        h('div', { class: 'menu-list' }, start, this.backButton()),
      ],
      focus: buttons.find((b) => b.d.value === this.difficulty)!.b,
    };
  }

  private sandboxScreen(): { nodes: Node[]; focus?: HTMLElement } {
    const o = this.sandbox;
    const colonies = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Colonies' });
    const colonyButtons = (
      [
        [1, 'Black only'],
        [2, 'Black & red'],
      ] as const
    ).map(([value, label]) => {
      const b = h('button', { type: 'button', class: 'seg-btn' }, label);
      b.addEventListener('click', () => {
        o.colonies = value;
        sync();
      });
      colonies.append(b);
      return { value, b };
    });
    const sync = (): void => {
      for (const { value, b } of colonyButtons) {
        b.setAttribute('aria-pressed', String(value === o.colonies));
      }
      aiRow.hidden = o.colonies === 1;
    };
    const slider = (
      id: string,
      label: string,
      key: 'ants' | 'foodPiles',
      min: number,
      max: number,
      step: number,
    ): HTMLElement => {
      const input = h('input', {
        id,
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
      });
      const out = h('output', { class: 'menu-value', for: id });
      const show = (): void => {
        input.value = String(o[key]);
        out.textContent = String(o[key]);
      };
      input.addEventListener('input', () => {
        o[key] = Number(input.value);
        show();
      });
      show();
      return h('label', { class: 'menu-row', for: id }, h('span', {}, label), input, out);
    };
    const check = (label: string, key: 'hazards' | 'ai' | 'winLose'): HTMLLabelElement => {
      const input = h('input', { type: 'checkbox' });
      input.checked = o[key];
      input.addEventListener('change', () => (o[key] = input.checked));
      return h('label', { class: 'menu-row' }, h('span', {}, label), input);
    };
    const aiRow = check('Red colony AI', 'ai');
    const seed = h('input', {
      id: 'sandbox-seed',
      type: 'text',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: 'Random',
      maxlength: '10',
    });
    const seedHelp = h('p', { class: 'menu-hint', role: 'status' });
    seed.addEventListener('input', () => {
      seedHelp.textContent = parseSeed(seed.value) === null ? 'Seed must be a whole number.' : '';
    });
    const start = this.button(
      'Start sandbox',
      () => {
        const parsed = parseSeed(seed.value);
        if (parsed === null) {
          seedHelp.textContent = 'Seed must be a whole number.';
          seed.focus();
          return;
        }
        this.opts.onNewGame({
          difficulty: this.difficulty,
          seed: parsed,
          tutorial: false,
          sandbox: { ...o },
        });
      },
      'primary',
    );
    const form = h(
      'div',
      { class: 'menu-scroll' },
      h('div', { class: 'menu-form' }, h('span', { class: 'menu-label' }, 'Colonies'), colonies),
      slider('sb-ants', 'Starting ants', 'ants', 20, 1500, 20),
      slider('sb-food', 'Food piles', 'foodPiles', 0, 20, 1),
      check('Hazards (spiders, antlions, rain)', 'hazards'),
      aiRow,
      check('Win / lose conditions', 'winLose'),
      h(
        'div',
        { class: 'menu-form' },
        h('label', { class: 'menu-label', for: 'sandbox-seed' }, 'Seed'),
        seed,
        seedHelp,
      ),
    );
    sync();
    return {
      nodes: [
        this.title('Sandbox', 'Place food, rocks and ants, tune the sim. No pressure.'),
        form,
        h('div', { class: 'menu-list' }, start, this.backButton()),
      ],
      focus: colonyButtons.find((b) => b.value === o.colonies)!.b,
    };
  }

  private settingsScreen(): { nodes: Node[]; focus?: HTMLElement } {
    const { settings } = this.opts;
    const syncers: (() => void)[] = [];
    const bind = (fn: () => void): void => {
      syncers.push(fn);
      fn();
    };
    const toggle = (
      label: string,
      key: 'scentVision' | 'followCamera' | 'reduceMotion' | 'showFps' | 'haptics' | 'batterySaver',
    ): HTMLElement => {
      const input = h('input', { type: 'checkbox' });
      input.addEventListener('change', () => settings.update({ [key]: input.checked }));
      bind(() => (input.checked = settings.value[key]));
      return h('label', { class: 'menu-row' }, h('span', {}, label), input);
    };
    const choice = <T extends string>(
      label: string,
      key: 'joystick' | 'joystickSide',
      options: readonly [T, string][],
    ): HTMLElement => {
      const select = h('select', {});
      for (const [value, text] of options) select.append(h('option', { value }, text));
      select.addEventListener('change', () =>
        settings.update({ [key]: select.value as JoystickMode | JoystickSide }),
      );
      bind(() => (select.value = settings.value[key]));
      return h('label', { class: 'menu-row' }, h('span', {}, label), select);
    };
    const slider = (
      label: string,
      key: 'uiScale' | 'soundVolume' | 'musicVolume',
      min: number,
      max: number,
      step: number,
    ): HTMLElement => {
      const input = h('input', {
        type: 'range',
        min: String(min),
        max: String(max),
        step: String(step),
      });
      const out = h('span', { class: 'menu-value' });
      const show = (): void => {
        input.value = String(settings.value[key]);
        out.textContent = `${Math.round(settings.value[key] * 100)}%`;
        input.setAttribute('aria-valuetext', out.textContent);
      };
      input.addEventListener('input', () => settings.update({ [key]: Number(input.value) }));
      bind(show);
      return h('label', { class: 'menu-row' }, h('span', {}, label), input, out);
    };
    this.settingsSync = () => syncers.forEach((fn) => fn());
    const form = h(
      'div',
      { class: 'menu-scroll' },
      h('h2', { class: 'menu-group' }, 'Gameplay'),
      toggle('Scent vision on by default', 'scentVision'),
      toggle('Camera follows your ant', 'followCamera'),
      h('h2', { class: 'menu-group' }, 'Controls'),
      choice<JoystickMode>('Virtual joystick', 'joystick', [
        ['auto', 'Auto (touch screens)'],
        ['on', 'Always show'],
        ['off', 'Hide'],
      ]),
      choice<JoystickSide>('Joystick side', 'joystickSide', [
        ['left', 'Left'],
        ['right', 'Right'],
      ]),
      h('h2', { class: 'menu-group' }, 'Display'),
      slider('UI scale', 'uiScale', UI_SCALE_MIN, UI_SCALE_MAX, 0.05),
      toggle('Reduce motion', 'reduceMotion'),
      toggle('Show FPS', 'showFps'),
      toggle('Battery saver (30 fps)', 'batterySaver'),
      toggle('Haptics', 'haptics'),
      h('h2', { class: 'menu-group' }, 'Audio'),
      slider('Sound volume', 'soundVolume', 0, 1, 0.05),
      slider('Music volume', 'musicVolume', 0, 1, 0.05),
    );
    return {
      nodes: [
        this.title('Settings'),
        form,
        h('div', { class: 'menu-list' }, this.backButton('Done')),
      ],
    };
  }

  private howToScreen(): { nodes: Node[]; focus?: HTMLElement } {
    const rows: [string, string, string][] = [
      ['Move your ant', 'Tap to move / joystick', 'Click to move / WASD'],
      ['Pan / zoom', 'Drag / pinch', 'Right-drag / wheel'],
      ['Pick up / drop food', 'Pick up button', 'E'],
      ['Recruit nearby ants', 'Recruit 5 / 10 buttons', 'R'],
      ['Lay trail', 'Trail toggle', 'Hold Shift'],
      ['Surface ↔ nest', 'Nest button / tap an entrance', 'Tab'],
      ['Colony panel', 'Panel at the top left', 'Panel at the top left'],
      ['Pause menu', 'Pause button / back', 'Esc'],
    ];
    const table = h(
      'table',
      { class: 'menu-table' },
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'col' }, 'Action'),
          h('th', { scope: 'col' }, 'Touch'),
          h('th', { scope: 'col' }, 'Keyboard & mouse'),
        ),
      ),
      h(
        'tbody',
        {},
        ...rows.map(([a, t, d]) =>
          h('tr', {}, h('th', { scope: 'row' }, a), h('td', {}, t), h('td', {}, d)),
        ),
      ),
    );
    const replay = this.button('Replay tutorial', () => this.opts.onReplayTutorial(), 'primary');
    return {
      nodes: [
        this.title('How to Play'),
        h(
          'div',
          { class: 'menu-scroll' },
          h('h2', { class: 'menu-group' }, 'Goal'),
          h(
            'p',
            {},
            'You lead the black colony. Gather food, grow your population and defend the nest, then find the red nest and kill the red queen. If your queen dies, you lose.',
          ),
          h('h2', { class: 'menu-group' }, 'Tips'),
          h(
            'ul',
            {},
            h(
              'li',
              {},
              'Lay a trail from food back to the nest: other ants follow it. Turn on Scent vision to see trails.',
            ),
            h('li', {}, 'Recruit ants to follow you, then lead them to fight or forage.'),
            h(
              'li',
              {},
              'In the nest, use the Colony panel to balance foragers, diggers and nurses, and the caste mix.',
            ),
            h('li', {}, 'Soldiers can raid the red nest once your ants have found it.'),
          ),
          h('h2', { class: 'menu-group' }, 'Controls'),
          h(
            'div',
            {
              class: 'menu-table-wrap',
              tabindex: '0',
              role: 'region',
              'aria-label': 'Controls table',
            },
            table,
          ),
        ),
        h('div', { class: 'menu-list' }, replay, this.backButton()),
      ],
    };
  }
}

export type { Settings };
