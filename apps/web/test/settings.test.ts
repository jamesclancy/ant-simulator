import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  SettingsStore,
  sanitizeSettings,
  type SettingsBackend,
} from '../src/ui/settings';

function memoryBackend(initial: Record<string, string> = {}): SettingsBackend & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    get: (k) => Promise.resolve(data[k] ?? null),
    set: (k, v) => {
      data[k] = v;
      return Promise.resolve();
    },
  };
}

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('x')).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps numbers and rejects bad enums', () => {
    const s = sanitizeSettings({ uiScale: 9, soundVolume: -3, joystick: 'bogus', showFps: 'yes' });
    expect(s.uiScale).toBe(1.5);
    expect(s.soundVolume).toBe(0);
    expect(s.joystick).toBe('auto');
    expect(s.showFps).toBe(false);
  });
});

describe('SettingsStore', () => {
  it('persists updates and restores them in a new store', async () => {
    const backend = memoryBackend();
    const a = new SettingsStore(backend);
    await a.load();
    a.update({ joystickSide: 'right', uiScale: 1.2, showFps: true });
    expect(JSON.parse(backend.data[SETTINGS_KEY]!)).toMatchObject({ joystickSide: 'right' });

    const b = new SettingsStore(backend);
    await b.load();
    expect(b.value.joystickSide).toBe('right');
    expect(b.value.uiScale).toBe(1.2);
    expect(b.value.showFps).toBe(true);
    expect(b.value.followCamera).toBe(true);
  });

  it('notifies only for real changes, with the changed keys', () => {
    const store = new SettingsStore(memoryBackend());
    const seen: string[][] = [];
    store.subscribe((_s, changed) => seen.push([...changed]));
    store.update({ reduceMotion: false });
    store.update({ reduceMotion: true });
    expect(seen).toEqual([['reduceMotion']]);
  });

  it('survives corrupt stored data', async () => {
    const store = new SettingsStore(memoryBackend({ [SETTINGS_KEY]: '{nope' }));
    await store.load();
    expect(store.value).toEqual(DEFAULT_SETTINGS);
  });
});
