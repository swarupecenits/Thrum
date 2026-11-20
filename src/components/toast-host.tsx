import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './icon';
import { MINI_GAP, MINI_H, TAB_BAR_H, tabsShown } from './layout';
import { Press } from './press';
import { T } from './text';
import { usePlayer } from '@/stores/player';
import { useToast, type Toast } from '@/stores/toast';
import { useUi } from '@/stores/ui';
import { radius, space, springs, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

/** One toast at a time, floating just above the mini player (or at the top over Now Playing). */
export function ToastHost() {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const current = useToast((s) => s.current);
  const hide = useToast((s) => s.hide);
  const hasQueue = usePlayer((s) => s.ids.length > 0);
  const playerOpen = useUi((s) => s.playerOpen);
  const [shown, setShown] = useState<Toast | null>(current);
  // A new toast replaces the one on screen at once; a dismissed one stays up while it fades out.
  if (current && current !== shown) setShown(current);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (current) {
      progress.set(withSpring(1, springs.snappy));
      if (current.tone === 'danger') haptic('warning');
      const ms = current.duration ?? (current.action ? 4800 : 2600);
      const timer = setTimeout(() => hide(current.id), ms);
      return () => clearTimeout(timer);
    }
    progress.set(withTiming(0, { duration: 160, easing: Easing.in(Easing.quad) }));
    const timer = setTimeout(() => setShown(null), 170);
    return () => clearTimeout(timer);
  }, [current, hide, progress]);

  const fromTop = playerOpen;
  const lift = insets.bottom + MINI_GAP + (hasQueue ? MINI_H + MINI_GAP : 0);
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    const dy = (1 - p) * 18;
    return {
      opacity: p,
      transform: [
        { translateY: fromTop ? -dy : dy - tabsShown.get() * TAB_BAR_H },
        { scale: 0.96 + 0.04 * p },
      ],
    };
  });

  if (!shown) return null;
  const tint = shown.tone === 'danger' ? c.danger : shown.tone === 'success' ? c.accent : c.ink2;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, fromTop ? { top: insets.top + space.sm } : { bottom: lift }]}>
      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={[styles.toast, { backgroundColor: c.raised, borderColor: c.lineStrong }, style]}>
        <Press
          onPress={() => hide(shown.id)}
          scale={1}
          accessibilityLabel={`${shown.message}. Dismiss`}
          style={styles.body}>
          {shown.icon ? <Icon name={shown.icon} size={18} color={tint} weight="bold" /> : null}
          <T variant="callout" style={styles.message} numberOfLines={2}>
            {shown.message}
          </T>
        </Press>
        {shown.action ? (
          <Press
            onPress={() => {
              shown.action?.onPress();
              hide(shown.id);
            }}
            haptic="tap"
            accessibilityLabel={shown.action.label}
            style={styles.action}>
            <T variant="button" color="accent">
              {shown.action.label}
            </T>
          </Press>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.md, right: space.md, alignItems: 'center' },
  toast: {
    width: '100%',
    maxWidth: 520,
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
  },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md, paddingLeft: space.lg, paddingRight: space.sm },
  message: { flex: 1 },
  action: { paddingHorizontal: space.lg, alignSelf: 'stretch', justifyContent: 'center' },
});
