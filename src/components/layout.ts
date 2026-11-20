import { Easing, makeMutable, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { usePlayer } from '@/stores/player';
import { useUi } from '@/stores/ui';
import { springs } from '@/theme';

export const TAB_BAR_H = 62;
export const MINI_H = 62;
export const MINI_GAP = 8;
export const TOP_BAR_H = 56;

/** Now Playing openness, 0 (mini player) to 1 (full screen). Drives the tab bar and overlay on the UI thread. */
export const expand = makeMutable(0);

/** 1 while a tab screen is showing (tab bar on screen), 0 on pushed detail screens. */
export const tabsShown = makeMutable(1);

export function setTabsShown(shown: boolean) {
  tabsShown.set(withTiming(shown ? 1 : 0, { duration: 260, easing: Easing.bezier(0.22, 1, 0.36, 1) }));
}

/** `velocity` is in "openness per second", so a fling carries straight into the spring. */
export function openPlayer(velocity = 0) {
  if (usePlayer.getState().ids.length === 0) return;
  if (!useUi.getState().playerOpen) useUi.setState({ playerOpen: true });
  expand.set(withSpring(1, { ...springs.player, velocity }));
}

export function closePlayer(velocity = 0) {
  if (useUi.getState().playerOpen) useUi.setState({ playerOpen: false });
  expand.set(withSpring(0, { ...springs.player, velocity }));
}

/** Records where a gesture-driven spring (already started on the UI thread) is heading. */
export function setPlayerOpen(open: boolean) {
  if (open && usePlayer.getState().ids.length === 0) return;
  if (useUi.getState().playerOpen !== open) useUi.setState({ playerOpen: open });
}

/** Space the floating chrome (tab bar, mini player) covers at the bottom of a screen. */
export function useBottomChrome(inTabs: boolean): number {
  const insets = useSafeAreaInsets();
  const hasQueue = usePlayer((s) => s.ids.length > 0);
  return insets.bottom + (inTabs ? TAB_BAR_H : 0) + (hasQueue ? MINI_H + MINI_GAP * 2 : MINI_GAP) + 12;
}
