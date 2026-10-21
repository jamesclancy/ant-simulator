import type { Settings, SettingsStore } from './settings';

/**
 * Push the CSS-driven settings (scale, joystick, motion) onto the document, live.
 * Gameplay settings (scent, follow) are applied by the game via `store.subscribe`.
 */
export function bindDocumentSettings(store: SettingsStore): void {
  const apply = (s: Readonly<Settings>): void => {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(s.uiScale));
    root.dataset.joystick = s.joystick;
    root.dataset.joystickSide = s.joystickSide;
    root.classList.toggle('reduce-motion', s.reduceMotion);
  };
  store.subscribe(apply);
  apply(store.value);
}

/** Frame-rate readout, shown when the "Show FPS" setting is on. */
export function createFpsMeter(): { el: HTMLElement; tick(fps: number): void } {
  const el = document.createElement('div');
  el.id = 'fps';
  el.hidden = true;
  document.body.append(el);
  let last = 0;
  return {
    el,
    tick(fps) {
      const now = performance.now();
      if (el.hidden || now - last < 500) return;
      last = now;
      el.textContent = `${Math.round(fps)} fps`;
    },
  };
}
