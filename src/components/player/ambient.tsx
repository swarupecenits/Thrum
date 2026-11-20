import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { mix } from '@/lib/color';
import { useNow, type Ambient } from '@/stores/now';

const LOCATIONS = [0, 0.48, 1] as const;

/** The backdrop's colour at `t` (0 top, 1 bottom), for edge fades that must melt into it. */
export function ambientAt(a: Ambient, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  const m = LOCATIONS[1];
  return k <= m ? mix(a.top, a.mid, k / m) : mix(a.mid, a.bottom, (k - m) / (1 - m));
}

function Layer({ ambient, fadeIn }: { ambient: Ambient; fadeIn: boolean }) {
  const opacity = useSharedValue(fadeIn ? 0 : 1);
  useEffect(() => {
    if (fadeIn) opacity.set(withTiming(1, { duration: 720, easing: Easing.out(Easing.quad) }));
  }, [fadeIn, opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <LinearGradient
        colors={[ambient.top, ambient.mid, ambient.bottom]}
        locations={LOCATIONS}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

/** The artwork-coloured wash behind Now Playing; cross-fades when the track changes. */
function AmbientBase() {
  const ambient = useNow((s) => s.ambient);
  const [slots, setSlots] = useState<{ cur: Ambient; prev: Ambient | null; n: number }>({
    cur: ambient,
    prev: null,
    n: 0,
  });
  if (slots.cur !== ambient) setSlots({ cur: ambient, prev: slots.cur, n: slots.n + 1 });

  useEffect(() => {
    if (!slots.prev) return;
    const id = setTimeout(() => setSlots((s) => (s.n === slots.n ? { ...s, prev: null } : s)), 900);
    return () => clearTimeout(id);
  }, [slots.n, slots.prev]);

  return (
    <>
      {slots.prev ? <Layer key={slots.n - 1} ambient={slots.prev} fadeIn={false} /> : null}
      <Layer key={slots.n} ambient={slots.cur} fadeIn={slots.n > 0} />
    </>
  );
}

export const AmbientBackdrop = memo(AmbientBase);
