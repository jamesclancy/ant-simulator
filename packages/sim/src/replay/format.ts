import type { Command, SimConfig } from '@ant/shared';
import { deflateSync, inflateSync } from 'fflate';

/**
 * Replay file container.
 *
 * ```
 * offset  size  field
 * 0       4     magic "ANTR"
 * 4       2     format version (u16 LE)
 * 6       2     reserved (0)
 * 8       4     base length B (u32 LE; 0 = the game starts fresh from `config`)
 * 12      B     base: a sim save (`Sim.serialize`, already compressed) the game started from
 * 12+B    ...   body: zlib-deflated UTF-8 JSON of `ReplayBody`
 * ```
 *
 * A replay is the sim's inputs, not its outputs: a fresh sim built from `config` (or the
 * `base` save) is stepped tick by tick, each command applied right before the step of the
 * tick it was applied at. `checksums` are state hashes every `checksumInterval` ticks that
 * a player compares to detect a replay run on a sim that no longer behaves the same.
 */
export const REPLAY_MAGIC = 'ANTR';
export const REPLAY_VERSION = 1;
/**
 * Bump whenever a sim change alters behaviour for the same seed and commands: older replays
 * then play with a warning (and most likely desync) instead of silently showing a different game.
 */
export const SIM_VERSION = 1;

export class ReplayError extends Error {
  constructor(
    readonly code: 'badMagic' | 'truncated' | 'corrupt' | 'newerVersion',
    message: string,
  ) {
    super(message);
    this.name = 'ReplayError';
  }
}

/** A command and the tick it was applied at (`sim.tick` just before the step). */
export interface TimedCommand {
  tick: number;
  command: Command;
}

export interface ReplayMeta {
  mode: 'quick' | 'sandbox';
  /** UTC date `YYYY-MM-DD` of the daily challenge this game was. */
  daily?: string;
  /** `Date.now()` when the game started (informational). */
  recordedAt?: number;
}

export interface ReplayBody {
  simVersion: number;
  /** The complete resolved config the sim ran with. */
  config: SimConfig;
  meta: ReplayMeta;
  /** First tick of the recording (0 for a fresh game, the loaded save's tick otherwise). */
  startTick: number;
  /** Tick the recording ended at. */
  endTick: number;
  /** -1 if the game was still running at the end, else the winner (see `Snapshot.winner`). */
  winner: number;
  /** Ordered by tick (stable within a tick). */
  commands: TimedCommand[];
  checksumInterval: number;
  /** `[tick, hash]` pairs, ascending. */
  checksums: [number, number][];
  /** Final live ants per colony, for the replay list. */
  populations: number[];
}

export interface ReplayData extends ReplayBody {
  version: number;
  /** Save bytes the game started from; absent when it started fresh from `config`. */
  base?: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeReplay(data: ReplayData): Uint8Array {
  const { version: _version, base, ...body } = data;
  const json = deflateSync(encoder.encode(JSON.stringify(body)), { level: 9 });
  const baseLen = base?.byteLength ?? 0;
  const out = new Uint8Array(12 + baseLen + json.byteLength);
  const view = new DataView(out.buffer);
  out.set(encoder.encode(REPLAY_MAGIC), 0);
  view.setUint16(4, REPLAY_VERSION, true);
  view.setUint32(8, baseLen, true);
  if (base) out.set(base, 12);
  out.set(json, 12 + baseLen);
  return out;
}

export function decodeReplay(bytes: Uint8Array): ReplayData {
  if (bytes.byteLength < 12) throw new ReplayError('truncated', 'replay file is too short');
  if (decoder.decode(bytes.subarray(0, 4)) !== REPLAY_MAGIC) {
    throw new ReplayError('badMagic', 'not an Ant Simulator replay');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version > REPLAY_VERSION) {
    throw new ReplayError('newerVersion', 'this replay was made by a newer version of the game');
  }
  const baseLen = view.getUint32(8, true);
  if (12 + baseLen > bytes.byteLength) throw new ReplayError('truncated', 'replay file is cut off');
  try {
    const body = JSON.parse(
      decoder.decode(inflateSync(bytes.subarray(12 + baseLen))),
    ) as ReplayBody;
    if (!Array.isArray(body.commands) || !body.config || typeof body.endTick !== 'number') {
      throw new Error('missing fields');
    }
    return {
      ...body,
      version,
      ...(baseLen ? { base: bytes.slice(12, 12 + baseLen) } : {}),
    };
  } catch (e) {
    if (e instanceof ReplayError) throw e;
    throw new ReplayError('corrupt', 'replay file is damaged');
  }
}

/** What the replay list shows, readable from the encoded bytes. */
export interface ReplayInfo {
  version: number;
  simVersion: number;
  seed: number;
  difficulty: string;
  sandbox: boolean;
  daily?: string;
  recordedAt?: number;
  startTick: number;
  endTick: number;
  winner: number;
  populations: number[];
  commandCount: number;
}

export function replayInfo(data: ReplayData): ReplayInfo {
  return {
    version: data.version,
    simVersion: data.simVersion,
    seed: data.config.seed,
    difficulty: data.config.difficulty,
    sandbox: data.meta.mode === 'sandbox',
    ...(data.meta.daily ? { daily: data.meta.daily } : {}),
    ...(data.meta.recordedAt ? { recordedAt: data.meta.recordedAt } : {}),
    startTick: data.startTick,
    endTick: data.endTick,
    winner: data.winner,
    populations: data.populations,
    commandCount: data.commands.length,
  };
}
