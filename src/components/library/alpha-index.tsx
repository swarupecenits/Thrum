import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { T } from '../text';
import { fonts, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

type AlphaIndexProps = {
  letters: readonly string[];
  /** Called as the finger crosses each letter. */
  onPick: (letter: string) => void;
  top: number;
  bottom: number;
  /**
   * Takes touches. On web, `box-none` hands its children `pointer-events: auto`, which beats a `none` set
   * further up, so the strip has to be switched off here rather than by a wrapper.
   */
  live: boolean;
};

const BUBBLE = 64;
/** Vertical room each visible letter needs; shorter strips show every other letter or so. */
const SLOT = 14;

/** Evenly spaced letters (first and last kept) when they don't all fit. */
function thin(letters: readonly string[], height: number): readonly string[] {
  const slots = Math.floor((height - 12) / SLOT);
  if (height <= 0 || letters.length <= slots || slots < 2) return letters;
  const step = (letters.length - 1) / (slots - 1);
  return Array.from({ length: slots }, (_, k) => letters[Math.round(k * step)]);
}

/** One UI style fast scroller: slide along the right edge and the list follows letter by letter. */
export function AlphaIndex({ letters, onPick, top, bottom, live }: AlphaIndexProps) {
  const c = useTheme();
  const height = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const active = useSharedValue(0);
  const last = useSharedValue(-1);
  const [bubble, setBubble] = useState<string | null>(null);
  const [stripH, setStripH] = useState(0);

  const latest = useRef({ letters, onPick });
  useEffect(() => {
    latest.current = { letters, onPick };
  });

  const emit = useCallback((i: number) => {
    const letter = latest.current.letters[i];
    if (letter === undefined) return;
    haptic('tick');
    setBubble(letter);
    latest.current.onPick(letter);
  }, []);
  const clear = useCallback(() => setBubble(null), []);

  const n = letters.length;
  const pick = (y: number) => {
    'worklet';
    const h = height.get();
    if (h <= 0 || n === 0) return;
    fingerY.set(Math.min(h, Math.max(0, y)));
    const i = Math.min(n - 1, Math.max(0, Math.floor((y / h) * n)));
    if (i !== last.get()) {
      last.set(i);
      scheduleOnRN(emit, i);
    }
  };

  const pan = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      'worklet';
      last.set(-1);
      active.set(withTiming(1, { duration: 90 }));
      pick(e.y);
    },
    onUpdate: (e) => {
      'worklet';
      pick(e.y);
    },
    onDeactivate: () => {
      'worklet';
      active.set(withTiming(0, { duration: 260 }));
      scheduleOnRN(clear);
    },
  });

  const strip = useAnimatedStyle(() => ({ backgroundColor: `rgba(255,255,255,${0.07 * active.get()})` }));
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: active.get(),
    transform: [{ translateY: fingerY.get() - BUBBLE / 2 }, { scale: 0.7 + 0.3 * active.get() }],
  }));

  if (n < 4) return null;

  return (
    <View pointerEvents={live ? 'box-none' : 'none'} style={[styles.wrap, { top, bottom }]}>
      <Animated.View pointerEvents="none" style={[styles.bubble, { backgroundColor: c.accent }, bubbleStyle]}>
        <T variant="display" color="onAccent" style={styles.bubbleText}>
          {bubble ?? ''}
        </T>
      </Animated.View>
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityRole="adjustable"
          accessibilityLabel="Jump to letter"
          accessibilityValue={{ text: bubble ?? letters[0] }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => {
            const at = Math.max(0, letters.indexOf(bubble ?? letters[0]));
            const next = Math.min(n - 1, Math.max(0, at + (e.nativeEvent.actionName === 'increment' ? 1 : -1)));
            setBubble(letters[next]);
            onPick(letters[next]);
          }}
          onLayout={(e) => {
            const h = e.nativeEvent.layout.height;
            height.set(h);
            setStripH(h);
          }}
          style={[styles.strip, strip]}
          testID="alpha-index">
          {thin(letters, stripH).map((l, k) => (
            <T key={`${l}${k}`} style={[styles.letter, { color: c.ink3 }]} allowFontScaling={false}>
              {l}
            </T>
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', right: 0, width: 96, alignItems: 'flex-end' },
  strip: {
    flex: 1,
    width: 26,
    marginRight: 2,
    borderRadius: 13,
    paddingVertical: 6,
    justifyContent: 'space-evenly',
    alignItems: 'center',
  },
  letter: { fontFamily: fonts.mono, fontSize: 10, lineHeight: 12, textAlign: 'center' },
  bubble: {
    position: 'absolute',
    top: 0,
    right: 40,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    borderBottomRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleText: { fontSize: 32, lineHeight: 38 },
});
