import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { T } from './text';
import { radius, springs, useBase } from '@/theme';
import { haptic } from '@/utils/haptics';

export type SegmentOption<V extends string | number> = { value: V; label: string; a11y?: string };

type SegmentedProps<V extends string | number> = {
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Spoken name of the group. */
  label: string;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const INSET = 3;

/** One UI style segmented control with a sliding thumb. */
export function Segmented<V extends string | number>({ options, value, onChange, label, size = 'md', style, testID }: SegmentedProps<V>) {
  const c = useBase();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const seg = options.length ? (width - INSET * 2) / options.length : 0;
  const x = useSharedValue(0);

  useEffect(() => {
    if (seg > 0) x.set(withSpring(index * seg, springs.snappy));
  }, [index, seg, x]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const h = size === 'sm' ? 34 : 40;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (Math.abs(w - width) < 0.5) return;
        // Place the thumb without animating on first layout.
        if (width === 0 && options.length) x.set(index * ((w - INSET * 2) / options.length));
        setWidth(w);
      }}
      style={[styles.root, { height: h, backgroundColor: c.fill }, style]}>
      {seg > 0 ? (
        <Animated.View
          style={[styles.thumb, { width: seg, height: h - INSET * 2, backgroundColor: c.raised, borderColor: c.lineStrong }, thumb]}
        />
      ) : null}
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            aria-checked={selected}
            accessibilityLabel={o.a11y ?? o.label}
            testID={testID ? `${testID}-${o.value}` : undefined}
            onPress={() => {
              if (selected) return;
              haptic('select');
              onChange(o.value);
            }}
            style={styles.option}>
            <T variant={size === 'sm' ? 'caption' : 'calloutMedium'} color={selected ? 'ink' : 'ink3'} numberOfLines={1}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', borderRadius: radius.pill, padding: INSET },
  thumb: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  option: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
});
