import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'tap' | 'select' | 'soft' | 'success' | 'warning' | 'error' | 'heavy' | 'tick';

let enabled = true;
let lastTick = 0;

export function setHapticsEnabled(value: boolean) {
  enabled = value;
}

export function haptic(kind: HapticKind = 'tap') {
  if (!enabled || Platform.OS === 'web') return;
  let p: Promise<void>;
  switch (kind) {
    case 'tick': {
      // Detents on knobs and sliders fire fast; keep them from blurring into a buzz.
      const now = Date.now();
      if (now - lastTick < 28) return;
      lastTick = now;
      p = Haptics.selectionAsync();
      break;
    }
    case 'select':
      p = Haptics.selectionAsync();
      break;
    case 'soft':
      p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
      break;
    case 'heavy':
      p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'success':
      p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      p = Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
    default:
      p = Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
  p.catch(() => {});
}
