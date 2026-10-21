import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Thin wrapper over Capacitor Haptics. A no-op on the web and while the "Haptics" setting is off;
 * errors (unsupported hardware, plugin missing) are swallowed so feedback never breaks gameplay.
 */
class HapticsService {
  enabled = true;
  private native = Capacitor.isNativePlatform();

  private run(fn: () => Promise<void>): void {
    if (!this.enabled || !this.native) return;
    void fn().catch(() => {});
  }

  /** Recruit / pickup / drop. */
  light(): void {
    this.run(() => Haptics.impact({ style: ImpactStyle.Light }));
  }

  /** The player ant is under attack. */
  warning(): void {
    this.run(() => Haptics.notification({ type: NotificationType.Warning }));
  }

  /** The player's queen died. */
  heavy(): void {
    this.run(() => Haptics.impact({ style: ImpactStyle.Heavy }));
  }
}

export const haptics = new HapticsService();
