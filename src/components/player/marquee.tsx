import { memo, useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type TextStyle } from 'react-native';
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
} from 'react-native-reanimated';

import { T, type InkColor } from '../text';
import type { TypeVariant } from '@/theme';

const GAP = 48;
/** Scroll speed in px per second; slow enough to read. */
const SPEED = 34;
const PAUSE_MS = 2200;

type MarqueeProps = {
  text: string;
  variant: TypeVariant;
  color?: InkColor | (string & {});
  /** Scrolls only while on screen; otherwise it sits still, ellipsized. */
  active: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
};

/** A single line that glides sideways when it doesn't fit, pausing at the start of every loop. */
function MarqueeBase({ text, variant, color, active, style, testID }: MarqueeProps) {
  const reduce = useReducedMotion();
  const [boxW, setBoxW] = useState(0);
  const [textW, setTextW] = useState(0);
  const x = useSharedValue(0);
  const overflow = boxW > 0 && textW > boxW + 1;
  const run = overflow && active && !reduce;

  useEffect(() => {
    cancelAnimation(x);
    x.set(0);
    if (!run) return;
    const dist = textW + GAP;
    x.set(
      withRepeat(
        withSequence(
          withDelay(PAUSE_MS, withTiming(-dist, { duration: (dist / SPEED) * 1000, easing: Easing.linear })),
          withTiming(0, { duration: 0 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(x);
  }, [run, textW, text, x]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View
      style={styles.box}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (Math.abs(w - boxW) > 0.5) setBoxW(w);
      }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      testID={testID}>
      {run ? (
        <Animated.View style={[styles.row, { width: textW * 2 + GAP + 2 }, slide]}>
          <T variant={variant} color={color} numberOfLines={1} style={[style, { width: textW + 1 }]}>
            {text}
          </T>
          <T variant={variant} color={color} numberOfLines={1} style={[style, { width: textW + 1, marginLeft: GAP - 1 }]}>
            {text}
          </T>
        </Animated.View>
      ) : (
        <T variant={variant} color={color} numberOfLines={1} style={style}>
          {text}
        </T>
      )}
      {/* Off-screen copy that measures the natural width of the line. */}
      <View style={styles.measure} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <T
          variant={variant}
          numberOfLines={1}
          style={style}
          onLayout={(e) => {
            const w = Math.ceil(e.nativeEvent.layout.width);
            if (w !== textW) setTextW(w);
          }}>
          {text}
        </T>
      </View>
    </View>
  );
}

export const Marquee = memo(MarqueeBase);

const styles = StyleSheet.create({
  box: { overflow: 'hidden', flexShrink: 1, flexGrow: 1 },
  row: { flexDirection: 'row' },
  measure: { position: 'absolute', top: 0, left: 0, width: 4000, flexDirection: 'row', opacity: 0 },
});
