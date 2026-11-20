import { memo, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { usePlayer } from '@/stores/player';
import { useAccent } from '@/theme';

const BARS = [
  { up: 260, down: 340, delay: 0, rest: 0.45 },
  { up: 210, down: 300, delay: 120, rest: 0.75 },
  { up: 300, down: 260, delay: 60, rest: 0.3 },
];

function Bar({ v, color, width, height }: { v: SharedValue<number>; color: string; width: number; height: number }) {
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: v.get() }] }));
  return <Animated.View style={[styles.bar, { width, height, borderRadius: width / 2, backgroundColor: color }, style]} />;
}

/** The little "now playing" equalizer; it dances while playing and rests when paused. */
function NowBarsBase({ size = 16, color }: { size?: number; color?: string }) {
  const accent = useAccent().color;
  const playing = usePlayer((s) => s.playWhenReady && s.status !== 'idle');
  const reduce = useReducedMotion();
  const a = useSharedValue(BARS[0].rest);
  const b = useSharedValue(BARS[1].rest);
  const c = useSharedValue(BARS[2].rest);

  useEffect(() => {
    const values = [a, b, c];
    values.forEach((v, i) => {
      const spec = BARS[i];
      cancelAnimation(v);
      if (playing && !reduce) {
        v.set(
          withDelay(
            spec.delay,
            withRepeat(
              withSequence(
                withTiming(1, { duration: spec.up, easing: Easing.out(Easing.quad) }),
                withTiming(0.22, { duration: spec.down, easing: Easing.inOut(Easing.quad) }),
              ),
              -1,
              true,
            ),
          ),
        );
      } else {
        v.set(withTiming(spec.rest, { duration: 220 }));
      }
    });
    return () => values.forEach((v) => cancelAnimation(v));
  }, [playing, reduce, a, b, c]);

  const w = Math.max(2, Math.round(size / 6));
  const tint = color ?? accent;
  return (
    <View style={[styles.wrap, { width: size, height: size, gap: Math.max(1.5, w * 0.6) }]} accessibilityLabel={playing ? 'Playing' : 'Paused'}>
      <Bar v={a} color={tint} width={w} height={size} />
      <Bar v={b} color={tint} width={w} height={size} />
      <Bar v={c} color={tint} width={w} height={size} />
    </View>
  );
}

export const NowBars = memo(NowBarsBase);

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  bar: { transformOrigin: 'bottom' },
});
