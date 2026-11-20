import { usePanGesture } from 'react-native-gesture-handler';
import { cancelAnimation, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { expand, setPlayerOpen, tabsShown } from '../layout';
import { miniTopFor, type NowGeometry } from './geometry';
import { openSheet } from '@/stores/ui';
import { springs } from '@/theme';
import { haptic } from '@/utils/haptics';

export const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

export const lerp = (a: number, b: number, t: number) => {
  'worklet';
  return a + (b - a) * t;
};

function openQueue() {
  haptic('soft');
  openSheet({ kind: 'queue' });
}

/**
 * Drag Now Playing down to fold it back into the mini player (it follows the finger); a flick up
 * opens the queue. One instance per GestureDetector.
 */
export function useClosePan(geo: NowGeometry, enabled: boolean) {
  const start = useSharedValue(1);
  const { height, insetBottom } = geo;
  return usePanGesture({
    enabled,
    activeOffsetY: [-20, 12],
    failOffsetX: [-20, 20],
    onActivate: () => {
      'worklet';
      cancelAnimation(expand);
      start.set(expand.get());
    },
    onUpdate: (e) => {
      'worklet';
      const travel = Math.max(1, miniTopFor(height, insetBottom, tabsShown.get()));
      expand.set(clamp01(start.get() - Math.max(0, e.translationY) / travel));
    },
    onDeactivate: (e) => {
      'worklet';
      const travel = Math.max(1, miniTopFor(height, insetBottom, tabsShown.get()));
      const velocity = -e.velocityY / travel;
      if (!e.canceled && (e.velocityY > 800 || (e.translationY > travel * 0.25 && e.velocityY > -300))) {
        expand.set(withSpring(0, { ...springs.player, velocity }));
        scheduleOnRN(setPlayerOpen, false);
        return;
      }
      expand.set(withSpring(1, { ...springs.player, velocity: expand.get() > 0.995 ? 0 : Math.max(0, velocity) }));
      if (!e.canceled && (e.translationY < -50 || e.velocityY < -800)) scheduleOnRN(openQueue);
    },
  });
}
