import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Native chrome for the Capacitor app: light status-bar icons over the dark game background.
 * Android edge-to-edge and the safe-area CSS variables come from the SystemBars config in
 * `apps/mobile/capacitor.config.ts`; this covers iOS and the Android status-bar colour.
 * A no-op on the web.
 */
export function initNativeShell(): void {
  if (!Capacitor.isNativePlatform()) return;
  // Style.Dark = light content (for dark backgrounds).
  void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  if (Capacitor.getPlatform() === 'android') {
    void StatusBar.setBackgroundColor({ color: '#1b2a1b' }).catch(() => {});
  }
}
