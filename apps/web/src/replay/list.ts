import type { ReplayInfo } from '@ant/sim/replay-format';
import { PLAYER_COLONY } from '@ant/shared';
import { h } from '../ui/dom';
import type { MenuScreenContext } from '../ui/menu';
import { exportReplay, pickReplayFile, replayFileName } from './files';
import type { ReplayMeta, ReplayStore } from './store';
import { newReplayId } from './store';
import { decodeReplay, replayInfo } from '@ant/sim/replay-format';
import { formatDuration } from '../daily/daily';

export interface ReplayListDeps {
  store: ReplayStore;
  /** Open `bytes` in the viewer (closes the menu). */
  watch(bytes: Uint8Array): void;
  notify(message: string): void;
}

export function replayTitle(info: ReplayInfo): string {
  if (info.daily) return `Daily ${info.daily}`;
  const mode = info.sandbox ? 'Sandbox' : 'Quick game';
  return `${mode} · ${info.difficulty} · seed ${info.seed}`;
}

export function replayResult(info: ReplayInfo): string {
  const length = formatDuration(info.endTick - info.startTick);
  if (info.sandbox) return length;
  const outcome =
    info.winner === PLAYER_COLONY
      ? 'Victory'
      : info.winner === -1
        ? 'Unfinished'
        : info.winner === -2
          ? 'Nobody won'
          : 'Defeat';
  return `${outcome} · ${length}`;
}

const kb = (n: number): string => (n < 1024 ? `${n} B` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Main menu → Replays: stored replays with Watch / Export / Delete, plus import. */
export function buildReplayScreen(
  ctx: MenuScreenContext,
  deps: ReplayListDeps,
): { nodes: Node[]; focus?: HTMLElement } {
  const list = h('div', { class: 'replay-list', 'aria-live': 'polite' }, 'Loading…');

  const row = (meta: ReplayMeta): HTMLElement => {
    const when = new Date(meta.savedAt).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const watch = ctx.button('Watch', () => {
      void deps.store.read(meta.id).then((bytes) => {
        if (!bytes) return deps.notify('That replay is missing.');
        deps.watch(bytes);
      });
    });
    const save = ctx.button(
      'Export',
      () => {
        void deps.store.read(meta.id).then((bytes) => {
          if (bytes)
            void exportReplay(bytes, replayFileName(meta.info.daily ?? `seed-${meta.info.seed}`));
        });
      },
      'secondary',
    );
    const del = ctx.button(
      'Delete',
      () => {
        void deps.store.delete(meta.id).then(() => ctx.rerender());
      },
      'danger',
    );
    return h(
      'div',
      { class: 'replay-row-item' },
      h('strong', {}, replayTitle(meta.info)),
      h('span', { class: 'menu-hint' }, `${replayResult(meta.info)} · ${when} · ${kb(meta.size)}`),
      h('div', { class: 'replay-actions' }, watch, save, del),
    );
  };

  void deps.store
    .list()
    .then((metas) => {
      if (!metas.length) {
        list.textContent = 'No replays yet. Finish or quit a game and it appears here.';
        return;
      }
      list.replaceChildren(...metas.map(row));
    })
    .catch(() => {
      list.textContent = 'Replays could not be loaded.';
    });

  const importBtn = ctx.button(
    'Import replay file…',
    () => {
      void pickReplayFile().then(async (bytes) => {
        if (!bytes) return;
        try {
          const info = replayInfo(decodeReplay(bytes));
          await deps.store.write(newReplayId(), bytes, { savedAt: Date.now(), info });
          deps.notify('Replay imported.');
          ctx.rerender();
        } catch (e) {
          deps.notify(e instanceof Error ? e.message : 'Could not read that file.');
        }
      });
    },
    'secondary',
  );
  return {
    nodes: [
      ctx.title('Replays', 'Your last games, re-run from their recorded inputs.'),
      list,
      h(
        'div',
        { class: 'menu-list' },
        importBtn,
        ctx.button('Back', () => ctx.back(), 'secondary'),
      ),
    ],
    focus: importBtn,
  };
}
