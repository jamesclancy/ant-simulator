import { MANUAL_SLOTS } from './store';
import type { SaveMeta, SaveSlot } from './store';
import type { SaveController } from './controller';
import './saveMenu.css';

const SLOT_LABELS: Record<SaveSlot, string> = {
  auto: 'Autosave',
  slot1: 'Slot 1',
  slot2: 'Slot 2',
  slot3: 'Slot 3',
};

function describe(meta: SaveMeta | undefined): string {
  if (!meta) return 'empty';
  const when = new Date(meta.savedAt).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [black = 0, red] = meta.info.populations;
  const minutes = Math.floor(meta.info.tick / 20 / 60);
  const pops = red === undefined ? `${black} ants` : `black ${black} · red ${red}`;
  return `${meta.info.sandbox ? 'Sandbox · ' : ''}${when} · ${minutes} min · ${pops}`;
}

export interface SaveMenuOptions {
  controller: SaveController;
  /** Opens/closes with this button. */
  button: HTMLElement;
  /** Tell the player something (toast). */
  notify(message: string): void;
  /** Optional screenshot for the slot (data URL). */
  thumbnail?(): string | undefined;
  /** Called after a game was loaded from a slot. */
  onLoaded?(): void;
}

/** Small popup listing the autosave and three manual slots with Save / Load buttons. */
export function mountSaveMenu(opts: SaveMenuOptions): { refresh(): Promise<void> } {
  const { controller, button } = opts;
  const notify = (message: string): void => opts.notify(message);
  const panel = document.createElement('div');
  panel.id = 'save-menu';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Save and load');
  document.body.appendChild(panel);

  const render = (metas: SaveMeta[]): void => {
    panel.replaceChildren();
    const slots: SaveSlot[] = ['auto', ...MANUAL_SLOTS];
    for (const slot of slots) {
      const meta = metas.find((m) => m.slot === slot);
      const row = document.createElement('div');
      row.className = 'save-row';
      row.dataset.slot = slot;
      const label = document.createElement('div');
      label.className = 'save-label';
      const name = document.createElement('strong');
      name.textContent = SLOT_LABELS[slot];
      const detail = document.createElement('span');
      detail.textContent = describe(meta);
      label.append(name, detail);
      row.appendChild(label);
      if (slot !== 'auto') row.appendChild(action('Save', () => save(slot)));
      const load = action('Load', () => loadSlot(slot));
      load.disabled = !meta;
      row.appendChild(load);
      panel.appendChild(row);
    }
  };

  const action = (text: string, run: () => Promise<void>): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => {
      b.disabled = true;
      void run().finally(() => refresh());
    });
    return b;
  };

  const refresh = async (): Promise<void> => {
    try {
      render(await controller.list());
    } catch {
      render([]);
    }
  };

  const save = async (slot: SaveSlot): Promise<void> => {
    try {
      await controller.save(slot, opts.thumbnail?.());
      notify(`Saved to ${SLOT_LABELS[slot]}`);
    } catch (e) {
      notify(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const loadSlot = async (slot: SaveSlot): Promise<void> => {
    try {
      if (await controller.load(slot)) {
        panel.hidden = true;
        opts.onLoaded?.();
        notify(`Loaded ${SLOT_LABELS[slot]}`);
      } else notify('That slot is empty');
    } catch (e) {
      notify(`Could not load: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    button.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) void refresh();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      // Closing the popup is all Esc does; don't also open the pause menu.
      e.preventDefault();
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  });
  return { refresh };
}
