import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { T } from '../text';
import { bassPulse, useSpectrum } from '@/audio/spectrum';
import { withAlpha } from '@/lib/color';
import { springs, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const SWEEP = 270;
const START = -SWEEP / 2;
/** Finger travel (pt) for the whole range. */
const TRAVEL = 190;

type BassKnobProps = {
  value: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  onEnd?: () => void;
  disabled?: boolean;
  size?: number;
  label?: string;
};

/**
 * A hardware-style rotary control: drag up (or right) to turn it, with a detent every dB. Its halo
 * breathes with the kick drum of whatever is playing, scaled by how much bass you've dialled in.
 */
export function BassKnob({ value, max = 12, step = 0.5, onChange, onEnd, disabled, size = 184, label = 'Bass boost' }: BassKnobProps) {
  const c = useTheme();
  const focused = useIsFocused();
  useSpectrum(focused && !disabled);

  const frac = Math.min(1, Math.max(0, value / max));
  const current = useSharedValue(value);
  const angle = useSharedValue(START + frac * SWEEP);
  const dragging = useSharedValue(false);
  const start = useSharedValue(value);
  const amount = useSharedValue(frac);

  useEffect(() => {
    amount.set(frac);
    if (dragging.get()) return;
    current.set(value);
    angle.set(withSpring(START + frac * SWEEP, springs.snappy));
  }, [value, frac, angle, current, dragging, amount]);

  const handlers = useRef({ onChange, onEnd });
  useEffect(() => {
    handlers.current = { onChange, onEnd };
  });
  const emit = useCallback((v: number, tick: boolean) => {
    if (tick) haptic('tick');
    handlers.current.onChange(v);
  }, []);
  const emitStart = useCallback(() => haptic('select'), []);
  const emitEnd = useCallback(() => handlers.current.onEnd?.(), []);

  const pan = usePanGesture({
    enabled: !disabled,
    minDistance: 0,
    onActivate: () => {
      'worklet';
      dragging.set(true);
      start.set(current.get());
      scheduleOnRN(emitStart);
    },
    onUpdate: (e) => {
      'worklet';
      const raw = start.get() + ((-e.translationY + e.translationX * 0.6) / TRAVEL) * max;
      const v = Math.min(max, Math.max(0, Math.round(raw / step) * step));
      const prev = current.get();
      if (v === prev) return;
      current.set(v);
      angle.set(withSpring(START + (v / max) * SWEEP, { ...springs.snappy, mass: 0.6 }));
      scheduleOnRN(emit, v, Math.floor(v) !== Math.floor(prev) || v === 0 || v === max);
    },
    onDeactivate: () => {
      'worklet';
      dragging.set(false);
      scheduleOnRN(emitEnd);
    },
  });

  const pointer = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.get()}deg` }] }));
  const halo = useAnimatedStyle(() => {
    const k = bassPulse.get() * amount.get();
    return { opacity: 0.12 + k * 0.75, transform: [{ scale: 1 + k * 0.07 }] };
  });

  const r = size / 2;
  const ticks = Math.round(max / step);
  const faceR = r - 34;
  const dotOrbit = r - 26;

  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min: 0, max, now: value, text: `${value.toFixed(1)} decibels` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          const dir = e.nativeEvent.actionName === 'increment' ? 1 : -1;
          onChange(Math.min(max, Math.max(0, Math.round(value + dir))));
        }}
        style={[{ width: size, height: size }, disabled ? styles.disabled : null]}
        testID="bass-knob">
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            { left: r - faceR - 10, top: r - faceR - 10, width: (faceR + 10) * 2, height: (faceR + 10) * 2, borderRadius: faceR + 10 },
            { backgroundColor: withAlpha(c.accent, 0.5), boxShadow: `0 0 36px ${withAlpha(c.accent, 0.55)}` },
            halo,
          ]}
        />
        <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="knobFace" cx="50%" cy="50%" fx="36%" fy="28%" r="60%">
              <Stop offset="0" stopColor="#34343B" />
              <Stop offset="0.55" stopColor="#1E1E23" />
              <Stop offset="1" stopColor="#111114" />
            </RadialGradient>
          </Defs>
          {Array.from({ length: ticks + 1 }, (_, i) => {
            const v = i * step;
            const major = Math.abs(v % 3) < 1e-6;
            const theta = ((START + (i / ticks) * SWEEP) * Math.PI) / 180;
            const r1 = r - 3;
            const r2 = r - (major ? 15 : 10);
            const lit = v <= value + 1e-6 && value > 0;
            return (
              <Line
                key={i}
                x1={r + r1 * Math.sin(theta)}
                y1={r - r1 * Math.cos(theta)}
                x2={r + r2 * Math.sin(theta)}
                y2={r - r2 * Math.cos(theta)}
                stroke={lit ? c.accent : major ? c.ink4 : c.lineStrong}
                strokeWidth={major ? 2.5 : 1.75}
                strokeLinecap="round"
              />
            );
          })}
          <Circle cx={r} cy={r} r={faceR} fill="url(#knobFace)" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
          <Circle cx={r} cy={r} r={faceR - 9} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
        </Svg>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, pointer]}>
          <View style={[styles.dot, { left: r - 4, top: r - dotOrbit - 4, backgroundColor: c.accent }]} />
        </Animated.View>
        <View pointerEvents="none" style={styles.readout}>
          <T variant="mono" tabular style={styles.value}>
            {value > 0 ? `+${value.toFixed(1)}` : '0.0'}
          </T>
          <T variant="label" color="ink3">
            dB bass
          </T>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.45 },
  halo: { position: 'absolute' },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4 },
  readout: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  value: { fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
});
