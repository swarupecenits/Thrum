import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { springs, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const THUMB = 20;
const PAD = THUMB / 2;

export type SliderProps = {
  value: number;
  min: number;
  max: number;
  /** 0 = continuous. */
  step?: number;
  /** Where the fill grows from (0 for a centred control like balance). Defaults to `min`. */
  origin?: number;
  /** A magnetic value that the thumb snaps to with a click. Defaults to `origin` when given. */
  detent?: number;
  /** Haptic tick each time the value crosses a multiple of this. */
  tickEvery?: number;
  onChange: (value: number) => void;
  onStart?: () => void;
  onEnd?: (value: number) => void;
  /** Spoken name of the control. */
  label: string;
  /** Spoken (and shown, by callers) value. */
  format?: (value: number) => string;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Horizontal slider that runs on the UI thread: drag or tap anywhere on it, vertical swipes still
 * scroll the page, and values only cross to JS when they change by a step.
 */
export function Slider({
  value,
  min,
  max,
  step = 0,
  origin,
  detent,
  tickEvery = 0,
  onChange,
  onStart,
  onEnd,
  label,
  format,
  color,
  disabled,
  style,
  testID,
}: SliderProps) {
  const c = useTheme();
  const range = max - min || 1;
  const from = origin ?? min;
  const snapTo = detent ?? origin;
  const snapWithin = range * 0.03;

  const width = useSharedValue(0);
  const frac = useSharedValue(Math.min(1, Math.max(0, (value - min) / range)));
  const active = useSharedValue(0);
  const dragging = useSharedValue(false);
  const last = useSharedValue(value);

  const handlers = useRef({ onChange, onStart, onEnd });
  useEffect(() => {
    handlers.current = { onChange, onStart, onEnd };
  });

  useEffect(() => {
    if (dragging.get()) return;
    last.set(value);
    frac.set(withTiming(Math.min(1, Math.max(0, (value - min) / range)), { duration: 160 }));
  }, [value, min, range, frac, last, dragging]);

  const emitChange = useCallback((v: number, tick: boolean) => {
    if (tick) haptic('tick');
    handlers.current.onChange(v);
  }, []);
  const emitStart = useCallback(() => handlers.current.onStart?.(), []);
  const emitEnd = useCallback((v: number) => handlers.current.onEnd?.(v), []);

  /** Returns the continuous fraction under the finger and publishes the stepped value. */
  const pick = (x: number): number => {
    'worklet';
    const w = width.get() - THUMB;
    if (w <= 0) return frac.get();
    let f = Math.min(1, Math.max(0, (x - PAD) / w));
    let v = min + f * range;
    if (step > 0) v = Math.round((v - min) / step) * step + min;
    v = Math.min(max, Math.max(min, Math.round(v * 1000) / 1000));
    let snapped = false;
    if (snapTo !== undefined && Math.abs(v - snapTo) <= snapWithin) {
      v = snapTo;
      snapped = true;
      f = (snapTo - min) / range;
    }
    const prev = last.get();
    if (v !== prev) {
      last.set(v);
      const crossed = tickEvery > 0 && Math.floor(v / tickEvery) !== Math.floor(prev / tickEvery);
      scheduleOnRN(emitChange, v, crossed || (snapped && prev !== snapTo) || v === min || v === max);
    }
    return f;
  };

  const pan = usePanGesture({
    enabled: !disabled,
    activeOffsetX: [-3, 3],
    failOffsetY: [-12, 12],
    onActivate: (e) => {
      'worklet';
      dragging.set(true);
      active.set(withTiming(1, { duration: 120 }));
      scheduleOnRN(emitStart);
      frac.set(pick(e.x));
    },
    onUpdate: (e) => {
      'worklet';
      frac.set(pick(e.x));
    },
    onDeactivate: () => {
      'worklet';
      dragging.set(false);
      active.set(withTiming(0, { duration: 200 }));
      frac.set(withSpring((last.get() - min) / range, springs.snappy));
      scheduleOnRN(emitEnd, last.get());
    },
  });

  const tap = useTapGesture({
    enabled: !disabled,
    maxDistance: 10,
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(emitStart);
      pick(e.x);
      frac.set(withTiming((last.get() - min) / range, { duration: 180 }));
      scheduleOnRN(emitEnd, last.get());
    },
  });

  const gesture = useCompetingGestures(pan, tap);
  const originFrac = Math.min(1, Math.max(0, (from - min) / range));

  const fill = useAnimatedStyle(() => {
    const w = Math.max(1, width.get() - THUMB);
    const a = originFrac;
    const b = frac.get();
    return {
      transform: [{ translateX: Math.min(a, b) * w }, { scaleX: Math.max(0.0001, Math.abs(b - a)) }],
    };
  });
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: frac.get() * Math.max(0, width.get() - THUMB) }, { scale: 1 + active.get() * 0.2 }],
  }));

  const tint = color ?? c.accent;
  const stepBy = step > 0 ? step : range / 20;

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value, text: format?.(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
          onChange(Math.min(max, Math.max(min, Math.round((value + dir * stepBy) * 1000) / 1000)));
        }}
        onLayout={(e) => width.set(e.nativeEvent.layout.width)}
        testID={testID}
        style={[styles.root, disabled ? styles.disabled : null, style]}>
        <View style={[styles.track, { backgroundColor: c.fillStrong }]}>
          <Animated.View style={[styles.fill, { backgroundColor: tint }, fill]} />
          {origin !== undefined && origin !== min ? (
            <View style={[styles.originMark, { left: `${originFrac * 100}%`, backgroundColor: c.ink4 }]} />
          ) : null}
        </View>
        <Animated.View style={[styles.thumb, { backgroundColor: c.ink }, thumb]} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { height: 40, justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  track: {
    position: 'absolute',
    left: PAD,
    right: PAD,
    height: 4,
    borderRadius: 2,
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
    borderRadius: 2,
    transformOrigin: 'left',
  },
  originMark: { position: 'absolute', top: -4, width: 2, height: 12, marginLeft: -1, borderRadius: 1 },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
  },
});
