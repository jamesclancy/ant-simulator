import { App } from '@capacitor/app';
import type { Settings, SettingsStore } from '../ui/settings';
import { AudioDirector } from './director';
import { WebAudioBackend } from './webAudio';

export { AudioDirector } from './director';
export type { DirectorContext } from './director';

/** Elements whose activation gets the UI click. */
const CLICKABLE = 'button, select, input[type="checkbox"], [role="button"]';

export interface AudioSystem {
  director: AudioDirector;
  backend: WebAudioBackend;
}

/**
 * Wire the audio engine to the page: browsers only allow sound after a user gesture (iOS needs
 * the context created *inside* one), so the first pointer/key/touch unlocks it; volumes follow the
 * settings; output stops while the tab or app is in the background.
 */
export function createAudio(settings: SettingsStore): AudioSystem {
  const backend = new WebAudioBackend();
  const director = new AudioDirector(backend);
  const applyVolumes = (s: Readonly<Settings>): void =>
    backend.setVolumes({ sfx: s.soundVolume, music: s.musicVolume, muted: s.muted });
  settings.subscribe(applyVolumes);
  applyVolumes(settings.value);

  const unlock = (): void => {
    backend.unlock();
    if (backend.ready) {
      for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
        window.removeEventListener(type, unlock, true);
      }
    }
  };
  for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(type, unlock, { capture: true, passive: true });
  }

  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element && e.target.closest(CLICKABLE)) director.uiClick();
    },
    true,
  );

  const background = (hidden: boolean): void => backend.setSuspended(hidden);
  document.addEventListener('visibilitychange', () => background(document.hidden));
  void App.addListener('appStateChange', ({ isActive }) => background(!isActive)).catch(() => {});
  background(document.hidden);

  return { director, backend };
}

/** Keep the HUD mute button's pressed state and label in sync with the setting, and toggle it. */
export function bindMuteButton(button: HTMLElement, settings: SettingsStore): void {
  const show = (s: Readonly<Settings>): void => {
    button.setAttribute('aria-pressed', String(s.muted));
    button.textContent = s.muted ? 'Sound off' : 'Sound on';
  };
  button.addEventListener('click', () => settings.update({ muted: !settings.value.muted }));
  settings.subscribe(show);
  show(settings.value);
}
