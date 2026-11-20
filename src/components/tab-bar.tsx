import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, type IconName, type IconWeight } from './icon';
import { expand, TAB_BAR_H } from './layout';
import { Press } from './press';
import { T } from './text';
import { withAlpha } from '@/lib/color';
import { springs, useTheme } from '@/theme';

const TABS: Record<string, { icon: IconName; label: string; active: IconWeight }> = {
  index: { icon: 'house', label: 'For you', active: 'fill' },
  library: { icon: 'vinyl-record', label: 'Library', active: 'fill' },
  vibe: { icon: 'magnifying-glass', label: 'Vibe', active: 'bold' },
  sound: { icon: 'equalizer', label: 'Sound', active: 'bold' },
};

const PILL_W = 58;

export function TabBar({ state, descriptors, emitter, navigateToTab }: BottomTabBarProps) {
  const c = useTheme();
  const insets = useSafeAreaInsets();
  const [slot, setSlot] = useState(0);
  const x = useSharedValue(0);

  useEffect(() => {
    if (slot > 0) x.set(withSpring(state.index * slot + (slot - PILL_W) / 2, springs.snappy));
  }, [state.index, slot, x]);

  const hide = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(1, Math.max(0, expand.get())) * (TAB_BAR_H + insets.bottom + 8) }],
  }));
  const pill = useAnimatedStyle(() => ({
    opacity: slot > 0 ? 1 : 0,
    transform: [{ translateX: x.get() }],
  }));

  return (
    <Animated.View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        { height: TAB_BAR_H + insets.bottom, paddingBottom: insets.bottom, backgroundColor: c.bg, borderTopColor: c.line },
        hide,
      ]}>
      <View
        style={styles.row}
        onLayout={(e) => {
          const next = e.nativeEvent.layout.width / Math.max(1, state.routes.length);
          if (Math.abs(next - slot) > 0.5) {
            x.set(state.index * next + (next - PILL_W) / 2);
            setSlot(next);
          }
        }}>
        <Animated.View style={[styles.pill, { backgroundColor: withAlpha(c.accent, 0.16) }, pill]} />
        {state.routes.map((route, index) => {
          const meta = TABS[route.name];
          if (!meta) return null;
          const focused = state.index === index;
          const options = descriptors[route.key]?.options;
          return (
            <Press
              key={route.key}
              onPress={() => {
                const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigateToTab(route.key);
              }}
              onLongPress={() => emitter.emit({ type: 'tabLongPress', target: route.key })}
              haptic={focused ? false : 'select'}
              scale={0.92}
              accessibilityRole="tab"
              aria-selected={focused}
              accessibilityLabel={meta.label}
              testID={options?.tabBarButtonTestID ?? `tab-${route.name}`}
              style={styles.tab}>
              <View style={styles.iconBox}>
                <Icon
                  name={meta.icon}
                  size={23}
                  color={focused ? c.accent : c.ink3}
                  weight={focused ? meta.active : 'regular'}
                />
              </View>
              <T variant="small" color={focused ? 'ink' : 'ink4'} style={styles.label} numberOfLines={1}>
                {meta.label}
              </T>
            </Press>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', maxWidth: 560, width: '100%', alignSelf: 'center' },
  pill: { position: 'absolute', left: 0, top: 8, width: PILL_W, height: 30, borderRadius: 15 },
  tab: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center', gap: 3 },
  iconBox: { height: 30, justifyContent: 'center' },
  label: { fontSize: 11, lineHeight: 13 },
});
