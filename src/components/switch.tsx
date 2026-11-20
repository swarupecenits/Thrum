import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { springs, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

type SwitchProps = {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  testID?: string;
};

const W = 50;
const H = 30;
const KNOB = 24;

export function Switch({ value, onValueChange, label, disabled, testID }: SwitchProps) {
  const c = useTheme();
  const p = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    p.set(withSpring(value ? 1 : 0, springs.snappy));
  }, [value, p]);

  const off = c.fillStrong;
  const on = c.accent;
  const knobOff = c.ink3;
  const knobOn = c.onAccent;
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.get(), [0, 1], [off, on]),
  }));
  const knob = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.get(), [0, 1], [knobOff, knobOn]),
    transform: [{ translateX: p.get() * (W - KNOB - 6) }, { scale: 0.86 + 0.14 * p.get() }],
  }));

  return (
    <Pressable
      role="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      aria-checked={value}
      disabled={disabled}
      hitSlop={10}
      testID={testID}
      onPress={() => {
        haptic('select');
        onValueChange(!value);
      }}
      style={disabled ? styles.disabled : null}>
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.knob, knob]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: W, height: H, borderRadius: H / 2, padding: 3, justifyContent: 'center' },
  knob: { width: KNOB, height: KNOB, borderRadius: KNOB / 2 },
  disabled: { opacity: 0.4 },
});
