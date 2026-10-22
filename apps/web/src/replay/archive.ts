import { PLAYER_COLONY } from '@ant/shared';
import { decodeReplay, replayInfo } from '@ant/sim/replay-format';
import type { DailyAttempt, DailyOutcome } from '../daily/daily';
import type { DailyStore } from '../daily/history';
import { saveReplay, type ReplayStore } from './store';

/** Games shorter than this (10 s of game time) aren't worth a replay. */
export const MIN_REPLAY_TICKS = 200;

/** The bits of the last snapshot the archive needs. */
export interface EndState {
  tick: number;
  winner: number;
  population: number;
}

export interface ArchiveResult {
  replayId?: string;
  attempt?: DailyAttempt;
}

/**
 * Keeps the replay of the game in progress once it ends (game over, quit, restart, new
 * game): fetches it from the worker, stores it (dropping the oldest beyond the limit) and,
 * for a daily-challenge game, records the attempt's result. Ends each game at most once.
 */
export class GameArchive {
  private current: { daily?: { date: string; n: number } } | null = null;

  constructor(
    private readonly sim: { getReplay(): Promise<Uint8Array> },
    private readonly store: ReplayStore,
    private readonly daily: DailyStore,
  ) {}

  /** A recordable game (Quick Game, Sandbox or a daily) just started. */
  begin(daily?: { date: string; n: number }): void {
    this.current = daily ? { daily } : {};
  }

  /** The running game is not recordable (menu backdrop, campaign) or has been dealt with. */
  clear(): void {
    this.current = null;
  }

  get active(): boolean {
    return this.current !== null;
  }

  /**
   * End the current game. Must be called before the next `init` is sent to the worker (it
   * asks the worker for the replay synchronously). Resolves with what was stored.
   */
  async end(state: EndState | null): Promise<ArchiveResult> {
    const game = this.current;
    this.current = null;
    if (!game || !state) return {};
    const outcome: DailyOutcome =
      state.winner === -1 ? 'quit' : state.winner === PLAYER_COLONY ? 'victory' : 'defeat';
    const request = state.tick >= MIN_REPLAY_TICKS ? this.sim.getReplay() : null;
    const result: ArchiveResult = {};
    try {
      const bytes = request ? await request : null;
      if (bytes) {
        const protectedIds = new Set(
          Object.values(this.daily.all())
            .flat()
            .flatMap((a) => (a.replayId ? [a.replayId] : [])),
        );
        const meta = await saveReplay(this.store, bytes, replayInfo(decodeReplay(bytes)), {
          protectedIds,
        });
        result.replayId = meta.id;
      }
    } catch {
      // Storage unavailable: the game just has no replay.
    }
    if (game.daily) {
      const attempt = this.daily.finish(game.daily.date, game.daily.n, {
        outcome,
        ticks: state.tick,
        population: state.population,
        ...(result.replayId ? { replayId: result.replayId } : {}),
      });
      if (attempt) result.attempt = attempt;
    }
    return result;
  }
}
