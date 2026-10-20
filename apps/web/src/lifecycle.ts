import { App } from '@capacitor/app';

/**
 * Pauses the sim while the app is backgrounded (native) or the tab is hidden (web),
 * and resumes it afterwards unless the player had paused it themselves.
 * `appStateChange` is the Capacitor App plugin event; `visibilitychange` covers browsers.
 */
export function pauseWhenBackgrounded(
  setPaused: (paused: boolean) => void,
  isUserPaused: () => boolean,
): void {
  const apply = (hidden: boolean): void => setPaused(hidden || isUserPaused());
  document.addEventListener('visibilitychange', () => apply(document.hidden));
  void App.addListener('appStateChange', ({ isActive }) => apply(!isActive)).catch(() => {});
}
