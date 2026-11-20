import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, useCompetingGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { expand } from '../layout';
import { T } from '../text';
import { durationMs, estimatePosition, positionMs } from '@/audio/clock';
import { useSecondTicker } from '@/hooks/use-clock';
import { formatDuration } from '@/lib/format';
import { player, usePlayer } from '@/stores/player';
import { springs } from '@/theme';
import { haptic } from '@/utils/haptics';

const TOUCH_H = 40;
const WAVE = 32;
const AMP = 3.2;
const STROKE = 3;
const SVG_H = Math.ceil(AMP * 2 + STROKE + 2);
const GAP = 6;
const THUMB_W = 5;
const THUMB_H = 20;
const BUBBLE_W = 64;

/** One continuous sine-ish wave (quadratic halves) that repeats every WAVE px. */
function squiggle(width: number): string {
  const c = SVG_H / 2;
  const half = WAVE / 2;
  let d = `M0 ${c}`;
  let up = true;
  for (let x = 0; x < width; x += half) {
    d += ` Q${x + half / 2} ${up ? c - 2 * AMP : c + 2 * AMP} ${x + half} ${c}`;
    up = !up;
  }
  return d;
}

const clamp01 = (v: number) => {
  'worklet';
  return Math.min(1, Math.max(0, v));
};

type SeekBarProps = {
  /** Now Playing is on screen: animate the wave and tick the clock. */
  active: boolean;
  color: string;
  /** Colour of the unplayed part. */
  rest: string;
  thumb: string;
};

/**
 * Android-style squiggly progress: the played part ripples while music plays and flattens on pause.
 * Everything moves with transforms on the UI thread, so it never re-lays out or redraws the path.
 */
function SeekBarBase({ active, color, rest, thumb }: SeekBarProps) {
  const playing = usePlayer((s) => s.playing);
  const dur = usePlayer((s) => s.durationMs);
  const reduce = useReducedMotion();
  const [w, setW] = useState(0);
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  const width = useSharedValue(0);
  const scrub = useSharedValue(-1);
  const phase = useSharedValue(0);
  const amp = useSharedValue(playing && !reduce ? 1 : 0);
  const grab = useSharedValue(0);
  const lastSec = useSharedValue(-1);

  useEffect(() => {
    amp.set(withTiming(playing && !reduce ? 1 : 0, { duration: 420, easing: Easing.out(Easing.quad) }));
  }, [playing, reduce, amp]);

  useEffect(() => {
    if (!active || !playing || reduce) {
      cancelAnimation(phase);
      return;
    }
    phase.set(0);
    phase.set(withRepeat(withTiming(WAVE, { duration: 1500, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(phase);
  }, [active, playing, reduce, phase]);

  const frac = useDerivedValue(() => {
    const s = scrub.get();
    if (s >= 0) return s;
    // Player closed: hold still so the styles below stay idle while the clock runs.
    if (expand.get() < 0.01) return 0;
    const d = durationMs.get();
    const W = width.get();
    if (d <= 0 || W <= 0) return 0;
    // Half-pixel steps: a 4-minute song moves ~1.5 px/s, so the styles update a few times a second, not 60.
    return Math.round(clamp01(positionMs.get() / d) * W * 2) / (W * 2);
  });

  const onBegin = (f: number) => {
    haptic('select');
    setScrubMs(f * usePlayer.getState().durationMs);
  };
  const onMove = (ms: number) => setScrubMs(ms);
  const onEnd = (f: number) => {
    player.seek(f * usePlayer.getState().durationMs);
    scrub.set(-1);
    setScrubMs(null);
  };
  const onCancel = () => setScrubMs(null);

  const pick = (x: number) => {
    'worklet';
    const W = width.get();
    return W > 0 ? clamp01(x / W) : 0;
  };

  const pan = usePanGesture({
    activeOffsetX: [-4, 4],
    failOffsetY: [-16, 16],
    onActivate: (e) => {
      'worklet';
      const f = pick(e.x);
      scrub.set(f);
      lastSec.set(-1);
      grab.set(withSpring(1, springs.snappy));
      scheduleOnRN(onBegin, f);
    },
    onUpdate: (e) => {
      'worklet';
      const f = pick(e.x);
      scrub.set(f);
      const sec = Math.floor((f * durationMs.get()) / 1000);
      if (sec !== lastSec.get()) {
        lastSec.set(sec);
        scheduleOnRN(onMove, sec * 1000);
      }
    },
    onDeactivate: (e) => {
      'worklet';
      grab.set(withSpring(0, springs.snappy));
      if (e.canceled) {
        scrub.set(-1);
        scheduleOnRN(onCancel);
      } else {
        scheduleOnRN(onEnd, scrub.get());
      }
    },
  });

  const tap = useTapGesture({
    maxDistance: 8,
    onActivate: (e) => {
      'worklet';
      const f = pick(e.x);
      scrub.set(f);
      scheduleOnRN(onEnd, f);
    },
  });

  const gesture = useCompetingGestures(pan, tap);

  const restStyle = useAnimatedStyle(() => {
    const W = width.get();
    const len = Math.max(0, W - frac.get() * W - GAP);
    return { transform: [{ scaleX: W > 0 ? Math.max(0.0001, len / W) : 0.0001 }] };
  });
  const flatStyle = useAnimatedStyle(() => {
    const W = width.get();
    const len = Math.max(0, frac.get() * W - GAP);
    return { opacity: 1 - amp.get(), transform: [{ scaleX: W > 0 ? Math.max(0.0001, len / W) : 0.0001 }] };
  });
  const clipStyle = useAnimatedStyle(() => {
    const W = width.get();
    const clip = Math.max(0, frac.get() * W - GAP);
    return { transform: [{ translateX: clip - W }] };
  });
  const waveStyle = useAnimatedStyle(() => {
    const W = width.get();
    const clip = Math.max(0, frac.get() * W - GAP);
    const a = amp.get();
    return {
      opacity: a,
      transform: [{ translateX: W - clip - WAVE + phase.get() }, { scaleY: 0.3 + 0.7 * a }],
    };
  });
  const thumbStyle = useAnimatedStyle(() => {
    const g = grab.get();
    return {
      transform: [{ translateX: frac.get() * width.get() - THUMB_W / 2 }, { scaleX: 1 + g * 0.4 }, { scaleY: 1 + g * 0.3 }],
    };
  });
  const bubbleStyle = useAnimatedStyle(() => {
    const W = width.get();
    const g = grab.get();
    const x = Math.min(Math.max(frac.get() * W - BUBBLE_W / 2, 0), Math.max(0, W - BUBBLE_W));
    return { opacity: g, transform: [{ translateX: x }, { translateY: (1 - g) * 6 }, { scale: 0.9 + 0.1 * g }] };
  });

  const path = w > 0 ? squiggle(w + WAVE * 2) : '';

  return (
    <View>
      <GestureDetector gesture={gesture}>
        <View
          style={styles.touch}
          onLayout={(e) => {
            const next = e.nativeEvent.layout.width;
            width.set(next);
            if (Math.abs(next - w) > 0.5) setW(next);
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Seek"
          accessibilityValue={{ text: `${formatDuration(estimatePosition())} of ${formatDuration(dur)}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => player.seekBy(e.nativeEvent.actionName === 'increment' ? 10_000 : -10_000)}
          testID="seek-bar">
          <View style={styles.lane} pointerEvents="none">
            <Animated.View style={[styles.line, styles.fromRight, { backgroundColor: rest }, restStyle]} />
            <Animated.View style={[styles.line, styles.fromLeft, { backgroundColor: color }, flatStyle]} />
            {w > 0 ? (
              <View style={styles.clipOuter}>
                <Animated.View style={[styles.clipInner, clipStyle]}>
                  <Animated.View style={[styles.wave, { width: w + WAVE * 2 }, waveStyle]}>
                    <Svg width={w + WAVE * 2} height={SVG_H}>
                      <Path d={path} stroke={color} strokeWidth={STROKE} strokeLinecap="round" fill="none" />
                    </Svg>
                  </Animated.View>
                </Animated.View>
              </View>
            ) : null}
          </View>
          <Animated.View
            pointerEvents="none"
            style={[styles.thumb, { backgroundColor: thumb }, thumbStyle]}
          />
          <Animated.View pointerEvents="none" style={[styles.bubble, bubbleStyle]}>
            <T variant="mono" color="#09090B" tabular>
              {formatDuration(scrubMs ?? 0)}
            </T>
          </Animated.View>
        </View>
      </GestureDetector>
      <Times active={active} scrubMs={scrubMs} dur={dur} />
    </View>
  );
}

function Times({ active, scrubMs, dur }: { active: boolean; scrubMs: number | null; dur: number }) {
  const now = useSecondTicker(active && scrubMs === null);
  const pos = scrubMs ?? estimatePosition(now);
  return (
    <View style={styles.times} pointerEvents="none">
      <T variant="mono" color="ink3" tabular>
        {formatDuration(pos)}
      </T>
      <T variant="mono" color="ink3" tabular>
        {dur > 0 ? `-${formatDuration(Math.max(0, dur - pos))}` : '--:--'}
      </T>
    </View>
  );
}

export const SeekBar = memo(SeekBarBase);

const styles = StyleSheet.create({
  touch: { height: TOUCH_H, justifyContent: 'center' },
  lane: { height: SVG_H, justifyContent: 'center' },
  line: { position: 'absolute', left: 0, right: 0, height: STROKE, borderRadius: STROKE / 2 },
  fromLeft: { transformOrigin: 'left' },
  fromRight: { transformOrigin: 'right' },
  clipOuter: { position: 'absolute', left: 0, right: 0, top: 0, height: SVG_H, overflow: 'hidden' },
  clipInner: { position: 'absolute', left: 0, right: 0, top: 0, height: SVG_H, overflow: 'hidden' },
  wave: { position: 'absolute', left: 0, top: 0, height: SVG_H },
  thumb: {
    position: 'absolute',
    left: 0,
    top: (TOUCH_H - THUMB_H) / 2,
    width: THUMB_W,
    height: THUMB_H,
    borderRadius: THUMB_W / 2,
  },
  bubble: {
    position: 'absolute',
    left: 0,
    top: -30,
    width: BUBBLE_W,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
});
