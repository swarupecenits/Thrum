import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, type ScrollViewInstance } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { T } from '../text';
import { space, springs, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

export type SectionTab<V extends string> = { id: V; label: string; count?: number };

type SectionTabsProps<V extends string> = {
  tabs: readonly SectionTab<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Tapping the tab that's already selected, e.g. to scroll back to the top. */
  onReselect?: (value: V) => void;
  testID?: string;
};

export const SECTION_TABS_H = 50;
const PAD = 12;

/** One UI style text tabs with a lime underline that springs between them; scrolls when they don't fit. */
export function SectionTabs<V extends string>({ tabs, value, onChange, onReselect, testID }: SectionTabsProps<V>) {
  const c = useTheme();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);
  const [frames, setFrames] = useState<Partial<Record<V, { x: number; w: number }>>>({});
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const placed = useRef(false);
  const fx = frames[value]?.x;
  const fw = frames[value]?.w;

  useEffect(() => {
    if (fx === undefined || fw === undefined) return;
    const lineX = fx + PAD;
    const lineW = Math.max(8, fw - PAD * 2);
    if (placed.current) {
      x.set(withSpring(lineX, springs.snappy));
      w.set(withSpring(lineW, springs.snappy));
    } else {
      x.set(lineX);
      w.set(lineW);
      placed.current = true;
    }
    scroll.current?.scrollTo({ x: Math.max(0, fx + fw / 2 - width / 2), animated: true });
  }, [fx, fw, width, x, w]);

  const line = useAnimatedStyle(() => ({ width: w.get(), transform: [{ translateX: x.get() }] }));

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      contentContainerStyle={styles.content}
      style={styles.root}
      testID={testID}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={tab.count === undefined ? tab.label : `${tab.label}, ${tab.count}`}
            testID={testID ? `${testID}-${tab.id}` : undefined}
            onLayout={(e) => {
              const { x: tx, width: tw } = e.nativeEvent.layout;
              setFrames((prev) => {
                const old = prev[tab.id];
                if (old && Math.abs(old.x - tx) < 0.5 && Math.abs(old.w - tw) < 0.5) return prev;
                return { ...prev, [tab.id]: { x: tx, w: tw } };
              });
            }}
            onPress={() => {
              if (selected) {
                onReselect?.(tab.id);
                return;
              }
              haptic('select');
              onChange(tab.id);
            }}
            style={styles.tab}>
            <T variant="calloutMedium" color={selected ? 'ink' : 'ink3'} numberOfLines={1}>
              {tab.label}
            </T>
            {tab.count !== undefined ? (
              <T variant="mono" color={selected ? 'ink3' : 'ink4'} tabular style={styles.count}>
                {tab.count}
              </T>
            ) : null}
          </Pressable>
        );
      })}
      <Animated.View pointerEvents="none" style={[styles.line, { backgroundColor: c.accent }, line]} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 0 },
  content: { paddingHorizontal: space.page - PAD, height: SECTION_TABS_H, alignItems: 'stretch' },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: PAD },
  count: { fontSize: 11 },
  line: { position: 'absolute', left: 0, bottom: 6, height: 3, borderRadius: 2 },
});
