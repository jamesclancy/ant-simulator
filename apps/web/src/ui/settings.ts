import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { PALETTE_MODES } from '../art/palette';
import type { PaletteMode } from '../art/palette';

export type JoystickMode = 'auto' | 'on' | 'off';
export type JoystickSide = 'left' | 'right';

export interface Settings {
  scentVision: boolean;
  followCamera: boolean;
  joystick: JoystickMode;
  joystickSide: JoystickSide;
  /** HUD / menu scale, 0.8..1.5. */
  uiScale: number;
  reduceMotion: boolean;
  /** Edge-of-screen arrows toward food piles that are out of view. */
  foodArrows: boolean;
  /** Speech bubbles with ant small talk over the colony. */
  antChatter: boolean;
  /** Colour-vision-safe colony / scent palette. */
  palette: PaletteMode;
  /** 0..1 volume of sound effects and of music. */
  soundVolume: number;
  musicVolume: number;
  /** Global mute (HUD button), keeps the volume sliders as they are. */
  muted: boolean;
  showFps: boolean;
  /** Vibrate on pickup/recruit, attacks and queen death (native app only). */
  haptics: boolean;
  /** Cap rendering at 30 fps to save battery and heat. */
  batterySaver: boolean;
  /** The first-game tutorial has been finished or skipped. */
  tutorialSeen: boolean;
}

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const SETTINGS_KEY = 'ant-sim:settings';

export const DEFAULT_SETTINGS: Settings = {
  scentVision: false,
  followCamera: true,
  joystick: 'auto',
  joystickSide: 'left',
  uiScale: 1,
  reduceMotion: false,
  foodArrows: true,
  antChatter: true,
  palette: 'default',
  soundVolume: 0.8,
  musicVolume: 0.5,
  muted: false,
  showFps: false,
  haptics: true,
  batterySaver: false,
  tutorialSeen: false,
};

/** Async key/value backend: localStorage on the web, Capacitor Preferences on native. */
export interface SettingsBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;

/** Coerce untrusted stored data into a valid Settings (unknown keys dropped, bad values defaulted). */
export function sanitizeSettings(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    scentVision: bool(r.scentVision, base.scentVision),
    followCamera: bool(r.followCamera, base.followCamera),
    joystick: oneOf(r.joystick, ['auto', 'on', 'off'], base.joystick),
    joystickSide: oneOf(r.joystickSide, ['left', 'right'], base.joystickSide),
    uiScale: clamp(r.uiScale, UI_SCALE_MIN, UI_SCALE_MAX, base.uiScale),
    reduceMotion: bool(r.reduceMotion, base.reduceMotion),
    foodArrows: bool(r.foodArrows, base.foodArrows),
    antChatter: bool(r.antChatter, base.antChatter),
    palette: oneOf(r.palette, PALETTE_MODES, base.palette),
    soundVolume: clamp(r.soundVolume, 0, 1, base.soundVolume),
    musicVolume: clamp(r.musicVolume, 0, 1, base.musicVolume),
    muted: bool(r.muted, base.muted),
    showFps: bool(r.showFps, base.showFps),
    haptics: bool(r.haptics, base.haptics),
    batterySaver: bool(r.batterySaver, base.batterySaver),
    tutorialSeen: bool(r.tutorialSeen, base.tutorialSeen),
  };
}

export function defaultBackend(): SettingsBackend {
  if (Capacitor.isNativePlatform()) {
    return {
      get: async (key) => (await Preferences.get({ key })).value,
      set: (key, value) => Preferences.set({ key, value }),
    };
  }
  return {
    get: (key) => {
      try {
        return Promise.resolve(localStorage.getItem(key));
      } catch {
        return Promise.resolve(null);
      }
    },
    set: (key, value) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage blocked (private mode): settings just last for the session.
      }
      return Promise.resolve();
    },
  };
}

type Listener = (settings: Readonly<Settings>, changed: readonly (keyof Settings)[]) => void;

/** Persisted settings. `load()` once at boot; `update()` applies live and writes through. */
export class SettingsStore {
  private current: Settings;
  private listeners = new Set<Listener>();

  constructor(
    private backend: SettingsBackend = defaultBackend(),
    defaults: Settings = DEFAULT_SETTINGS,
  ) {
    this.current = { ...defaults };
  }

  get value(): Readonly<Settings> {
    return this.current;
  }

  async load(): Promise<void> {
    try {
      const text = await this.backend.get(SETTINGS_KEY);
      if (text) this.current = sanitizeSettings(JSON.parse(text), this.current);
    } catch {
      // Corrupt or unreadable: keep defaults.
    }
    this.emit(Object.keys(this.current) as (keyof Settings)[]);
  }

  update(patch: Partial<Settings>): void {
    const next = sanitizeSettings({ ...this.current, ...patch }, this.current);
    const changed = (Object.keys(next) as (keyof Settings)[]).filter(
      (k) => next[k] !== this.current[k],
    );
    if (changed.length === 0) return;
    this.current = next;
    void this.backend.set(SETTINGS_KEY, JSON.stringify(next));
    this.emit(changed);
  }

  /** Called on every change (and once after `load`). Returns an unsubscribe function. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(changed: readonly (keyof Settings)[]): void {
    for (const fn of this.listeners) fn(this.current, changed);
  }
}
