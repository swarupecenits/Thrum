import { useIsFocused } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { T } from '../text';
import { peakDb, reductionDb, useSpectrum } from '@/audio/spectrum';
import { radius, space, useTheme } from '@/theme';

const FLOOR_DB = -48;
/** Gain reduction that fills the limiter bar; heavy bass boosts rarely need more. */
const FULL_CATCH_DB = 6;

/**
 * Two live bars, updated on the UI thread: the output peak, and how hard the limiter is working.
 * A limiter bar that's always busy means the boosts are pushing too hard; lower the preamp a little.
 */
export function OutputMeters() {
  const c = useTheme();
  const focused = useIsFocused();
  useSpectrum(focused);

  const level = useAnimatedStyle(() => {
    const f = (peakDb.get() - FLOOR_DB) / -FLOOR_DB;
    return { transform: [{ scaleX: Math.max(0.0001, Math.min(1, f)) }] };
  });
  const caught = useAnimatedStyle(() => ({
    transform: [{ scaleX: Math.max(0.0001, Math.min(1, reductionDb.get() / FULL_CATCH_DB)) }],
  }));

  return (
    <View style={styles.wrap} accessible accessibilityLabel="Live output level and limiter activity" testID="sound-meters">
      <View style={styles.row}>
        <T variant="label" color="ink4" style={styles.label}>
          Level
        </T>
        <View style={[styles.track, { backgroundColor: c.fill }]}>
          <Animated.View style={[styles.fill, { backgroundColor: c.ink3 }, level]} />
        </View>
      </View>
      <View style={styles.row}>
        <T variant="label" color="ink4" style={styles.label}>
          Limiter
        </T>
        <View style={[styles.track, { backgroundColor: c.fill }]}>
          <Animated.View style={[styles.fill, { backgroundColor: c.accent }, caught]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  label: { width: 64 },
  track: { flex: 1, height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { ...StyleSheet.absoluteFill, borderRadius: radius.pill, transformOrigin: 'left' },
});
