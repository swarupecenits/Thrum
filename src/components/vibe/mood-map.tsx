import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { Button } from '../buttons';
import { T } from '../text';
import { formatCount } from '@/lib/format';
import type { VibeContext } from '@/lib/types';
import { estimatePoint, rankByPoint } from '@/lib/vibe';
import { player } from '@/stores/player';
import { radius, space, springs, useBase } from '@/theme';
import { haptic } from '@/utils/haptics';

const H = 250;
const PUCK = 30;
const MAX_DOTS = 260;
const RESULTS = 40;
const CORNER_INK = 'rgba(255,255,255,0.78)';

export function quadrantName(energy: number, valence: number): string {
  const e = energy - 0.5;
  const v = valence - 0.5;
  if (Math.hypot(e, v) < 0.14) return 'Balanced';
  if (e >= 0) return v >= 0 ? 'Euphoric' : 'Intense';
  return v >= 0 ? 'Serene' : 'Melancholy';
}

type MoodMapProps = { ctx: VibeContext };

/**
 * Your library as a constellation: energy runs up, positivity runs right. Drop the puck anywhere
 * and Thrum queues the songs that live there.
 */
export function MoodMap({ ctx }: MoodMapProps) {
  const c = useBase();
  const [width, setWidth] = useState(0);
  const [point, setPoint] = useState({ energy: 0.62, valence: 0.6 });

  const ids = rankByPoint(ctx, point.energy, point.valence, RESULTS).map((r) => r.id);
  const name = quadrantName(point.energy, point.valence);

  const tracks = ctx.lib.tracks;
  const stride = Math.max(1, Math.ceil(tracks.length / MAX_DOTS));
  const dots: { key: string; x: number; y: number }[] = [];
  if (width > 0) {
    for (let i = 0; i < tracks.length; i += stride) {
      const t = tracks[i];
      const p = estimatePoint(t, ctx.features.get(t.id));
      dots.push({ key: t.id, x: 6 + p.valence * (width - 12), y: 6 + (1 - p.energy) * (H - 12) });
    }
  }

  const px = useSharedValue(-1);
  const py = useSharedValue(-1);
  const held = useSharedValue(0);
  const w = useSharedValue(0);

  const commit = useCallback((energy: number, valence: number) => {
    haptic('select');
    setPoint({ energy, valence });
  }, []);

  const pan = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      'worklet';
      held.set(withTiming(1, { duration: 120 }));
      px.set(Math.min(w.get(), Math.max(0, e.x)));
      py.set(Math.min(H, Math.max(0, e.y)));
    },
    onUpdate: (e) => {
      'worklet';
      px.set(Math.min(w.get(), Math.max(0, e.x)));
      py.set(Math.min(H, Math.max(0, e.y)));
    },
    onDeactivate: () => {
      'worklet';
      held.set(withSpring(0, springs.snappy));
      const width = w.get();
      if (width <= 0 || px.get() < 0) return;
      scheduleOnRN(commit, 1 - py.get() / H, px.get() / width);
    },
  });

  const puck = useAnimatedStyle(() => {
    const x = px.get() < 0 ? point.valence * w.get() : px.get();
    const y = py.get() < 0 ? (1 - point.energy) * H : py.get();
    return {
      transform: [{ translateX: x - PUCK / 2 }, { translateY: y - PUCK / 2 }, { scale: 1 + held.get() * 0.25 }],
    };
  });

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={pan}>
        <View
          style={[styles.pad, { height: H, borderColor: c.line }]}
          onLayout={(e) => {
            const lw = Math.round(e.nativeEvent.layout.width);
            w.set(lw);
            setWidth(lw);
          }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Mood map"
          accessibilityHint="Energy runs up, positivity runs right."
          accessibilityValue={{
            text: `${name}, ${Math.round(point.energy * 100)} percent energy, ${Math.round(point.valence * 100)} percent positive`,
          }}
          accessibilityActions={[
            { name: 'increment', label: 'More energy' },
            { name: 'decrement', label: 'Less energy' },
          ]}
          onAccessibilityAction={(e) => {
            const d = e.nativeEvent.actionName === 'increment' ? 0.1 : -0.1;
            px.set(-1);
            py.set(-1);
            setPoint((p) => ({ ...p, energy: Math.min(1, Math.max(0, p.energy + d)) }));
          }}
          testID="mood-map">
          {width > 0 ? (
            <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="mmTop" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#E11D48" />
                  <Stop offset="1" stopColor="#F59E0B" />
                </LinearGradient>
                <LinearGradient id="mmBottom" x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor="#3730A3" />
                  <Stop offset="1" stopColor="#0D9488" />
                </LinearGradient>
                <LinearGradient id="mmFade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#FFFFFF" stopOpacity={1} />
                  <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
                </LinearGradient>
                <Mask id="mmMask" x="0" y="0" width={width} height={H} maskUnits="userSpaceOnUse">
                  <Rect x="0" y="0" width={width} height={H} fill="url(#mmFade)" />
                </Mask>
              </Defs>
              <Rect x="0" y="0" width={width} height={H} fill="url(#mmBottom)" />
              <Rect x="0" y="0" width={width} height={H} fill="url(#mmTop)" mask="url(#mmMask)" />
              <Rect x="0" y="0" width={width} height={H} fill="rgba(9,9,11,0.42)" />
              <Rect x={width / 2 - 0.5} y="0" width="1" height={H} fill="rgba(255,255,255,0.12)" />
              <Rect x="0" y={H / 2 - 0.5} width={width} height="1" fill="rgba(255,255,255,0.12)" />
              {dots.map((d) => (
                <Circle key={d.key} cx={d.x} cy={d.y} r={1.8} fill="rgba(255,255,255,0.55)" />
              ))}
            </Svg>
          ) : null}
          <T variant="label" color={CORNER_INK} style={[styles.corner, styles.tl]}>
            Intense
          </T>
          <T variant="label" color={CORNER_INK} style={[styles.corner, styles.tr]}>
            Euphoric
          </T>
          <T variant="label" color={CORNER_INK} style={[styles.corner, styles.bl]}>
            Melancholy
          </T>
          <T variant="label" color={CORNER_INK} style={[styles.corner, styles.br]}>
            Serene
          </T>
          {width > 0 ? <Animated.View pointerEvents="none" style={[styles.puck, puck]} /> : null}
        </View>
      </GestureDetector>
      <View style={styles.footer}>
        <View style={styles.footerText}>
          <T variant="headline" numberOfLines={1}>
            {name}
          </T>
          <T variant="small" color="ink3" numberOfLines={1}>
            {ids.length ? `${formatCount(ids.length, 'song')} live around here` : 'Nothing here yet'}
          </T>
        </View>
        <Button
          label="Play"
          icon="play"
          size="sm"
          disabled={!ids.length}
          onPress={() => player.playIds(ids, 0, { source: { kind: 'vibe', label: `Mood map \u00b7 ${name}` } })}
          testID="mood-map-play"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  pad: { borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, backgroundColor: '#18181C' },
  corner: { position: 'absolute' },
  tl: { top: 12, left: 14 },
  tr: { top: 12, right: 14 },
  bl: { bottom: 12, left: 14 },
  br: { bottom: 12, right: 14 },
  puck: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: PUCK,
    height: PUCK,
    borderRadius: PUCK / 2,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(255,255,255,0.22)',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  footerText: { flex: 1, gap: 2 },
});
