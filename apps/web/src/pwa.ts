import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';

/**
 * Register the offline service worker (web only). When a new build is waiting, show a
 * "New version available" bar; reloading activates it. Native web views ship the assets in
 * the app bundle, so no worker is registered there.
 */
export function registerServiceWorker(): void {
  if (Capacitor.isNativePlatform() || !('serviceWorker' in navigator)) return;
  const update = registerSW({
    onNeedRefresh() {
      const bar = document.createElement('div');
      bar.id = 'update-bar';
      bar.setAttribute('role', 'alert');
      const msg = document.createElement('span');
      msg.textContent = 'New version available';
      const reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload';
      reload.addEventListener('click', () => void update(true));
      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Later';
      dismiss.className = 'secondary';
      dismiss.addEventListener('click', () => bar.remove());
      bar.append(msg, reload, dismiss);
      document.body.append(bar);
    },
  });
}
