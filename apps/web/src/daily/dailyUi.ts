import { h } from '../ui/dom';
import type { MenuScreenContext } from '../ui/menu';
import {
  bestAttempt,
  dailySetup,
  dateKey,
  describeAttempt,
  shareText,
  type DailyAttempt,
  type DailySetup,
} from './daily';
import type { DailyStore } from './history';
import './daily.css';

export interface DailyDeps {
  store: DailyStore;
  /** Start the day's game as attempt `attempt` (closes the menu). */
  play(setup: DailySetup, attempt: DailyAttempt): void;
  /** Watch the stored replay of an attempt. */
  watch(replayId: string): void;
  notify(message: string): void;
  /** The current UTC date (injectable for tests). */
  today?: () => string;
}

/** Web Share where available, else the clipboard. */
export async function shareResult(text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return 'shared';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

const DIFFICULTY_LABEL = { easy: 'Easy', normal: 'Normal', hard: 'Hard' } as const;

/** Main menu → Daily Challenge: today's fixed setup, your attempts, recent days. */
export function buildDailyScreen(
  ctx: MenuScreenContext,
  deps: DailyDeps,
): { nodes: Node[]; focus?: HTMLElement } {
  const date = (deps.today ?? dateKey)();
  const setup = dailySetup(date);
  const attempts = deps.store.attempts(date);
  const official = attempts.find((a) => a.n === 1);
  const best = bestAttempt(attempts);

  const stat = (label: string, value: string): HTMLElement =>
    h('div', { class: 'daily-stat' }, h('span', {}, label), h('strong', {}, value));
  const card = h(
    'div',
    { class: 'daily-card' },
    h('h2', {}, date),
    h(
      'div',
      { class: 'daily-stats' },
      stat('Difficulty', DIFFICULTY_LABEL[setup.difficulty]),
      stat('Spiders', String(setup.spiders)),
      stat('Antlion pits', String(setup.antlions)),
      stat('Rain', setup.rain ? 'On' : 'Off'),
    ),
    h('p', { class: 'menu-hint' }, `Seed ${setup.seed}. Everyone gets the same yard today.`),
    h(
      'p',
      { class: 'daily-official' },
      official
        ? `Counting attempt: ${official.outcome ? describeAttempt(official) : 'unfinished'}`
        : 'Your first attempt today is the one that counts.',
    ),
  );

  const playLabel = official ? 'Retry (not counted)' : "Play today's challenge";
  const play = ctx.button(
    playLabel,
    () => {
      const attempt = deps.store.begin(date);
      ctx.close();
      deps.play(setup, attempt);
    },
    'primary',
  );

  const actions = h('div', { class: 'menu-list' }, play);
  if (best) {
    actions.append(
      ctx.button('Share result', () => {
        void shareResult(shareText(date, best)).then((how) =>
          deps.notify(
            how === 'copied' ? 'Result copied.' : how === 'failed' ? 'Could not share.' : 'Shared.',
          ),
        );
      }),
    );
    if (best.replayId) {
      const id = best.replayId;
      actions.append(ctx.button('Watch best replay', () => deps.watch(id), 'secondary'));
    }
  }
  actions.append(ctx.button('Back', () => ctx.back(), 'secondary'));

  const history = h('ol', { class: 'daily-history', 'aria-label': 'Recent days' });
  const days = Object.entries(deps.store.all())
    .filter(([d]) => d !== date)
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .slice(0, 7);
  for (const [d, list] of days) {
    const first = list.find((a) => a.n === 1);
    const top = bestAttempt(list);
    history.append(
      h(
        'li',
        {},
        h('span', {}, d),
        h(
          'span',
          {},
          first?.outcome ? describeAttempt(first) : 'unfinished',
          top && top !== first ? ` · best retry: ${describeAttempt(top)}` : '',
        ),
      ),
    );
  }
  const tries = attempts.length
    ? h(
        'ul',
        { class: 'daily-tries', 'aria-label': 'Today' },
        ...attempts.map((a) =>
          h(
            'li',
            {},
            `#${a.n}${a.n > 1 ? ' (retry)' : ''}: `,
            a.outcome ? describeAttempt(a) : 'unfinished',
          ),
        ),
      )
    : null;

  return {
    nodes: [
      ctx.title(
        'Daily Challenge',
        'One seed per day, the same for everyone. Scores stay on this device for now.',
      ),
      card,
      tries,
      actions,
      days.length ? h('h3', { class: 'menu-label' }, 'Recent days') : null,
      days.length ? history : null,
    ].filter((n): n is HTMLElement => !!n),
    focus: play,
  };
}
