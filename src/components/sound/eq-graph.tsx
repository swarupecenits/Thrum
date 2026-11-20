import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureDetector, usePanGesture, useSimultaneousGestures, useTapGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedProps, useSharedValue } from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { T } from '../text';
import { SPECTRUM_BANDS, spectrumBands, useSpectrum } from '@/audio/spectrum';
import { withAlpha } from '@/lib/color';
import { bandLabel, curveDb, EQ_BANDS, freqToX, logFreqs } from '@/lib/eq';
import { formatDb } from '@/lib/format';
import type { SoundParams } from '@/lib/types';
import { fonts, radius, space, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const H = 232;
const PAD_X = 16;
const TOP = 18;
const BOTTOM = 26;
const RANGE = 15;
const BAND_MAX = 12;
const CURVE_FREQS = logFreqs(120, 20, 20000);
const SPECTRUM_FREQS = logFreqs(SPECTRUM_BANDS, 30, 16000);

type EqGraphProps = {
  params: SoundParams;
  /** Bypassed or disabled: the curve greys out. */
  muted: boolean;
  onBand: (index: number, db: number) => void;
  onEnd?: () => void;
};

/**
 * The 10-band editor: grab anywhere and drag up or down to move the nearest band, double-tap to
 * zero it. The live spectrum of what's playing breathes behind the curve.
 */
export function EqGraph({ params, muted, onBand, onEnd }: EqGraphProps) {
  const c = useTheme();
  const focused = useIsFocused();
  useSpectrum(focused);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(1, width - PAD_X * 2);
  const plotH = H - TOP - BOTTOM;
  const xOf = (f: number) => PAD_X + freqToX(f, plotW);
  const yOf = (db: number) => TOP + (1 - (Math.max(-RANGE, Math.min(RANGE, db)) + RANGE) / (2 * RANGE)) * plotH;
  const zeroY = yOf(0);
  const bandXs = EQ_BANDS.map(xOf);
  const spectrumXs = SPECTRUM_FREQS.map(xOf);
  const bottomY = TOP + plotH;

  // The handles track the store, but gestures read the latest gains from a shared copy.
  const gains = useSharedValue<number[]>(params.bands.slice());
  useEffect(() => {
    gains.set(params.bands.slice());
  }, [params.bands, gains]);

  const handlers = useRef({ onBand, onEnd });
  useEffect(() => {
    handlers.current = { onBand, onEnd };
  });
  const emitBand = useCallback((i: number, db: number, tick: boolean) => {
    if (tick) haptic('tick');
    handlers.current.onBand(i, db);
  }, []);
  const emitStart = useCallback((i: number) => {
    haptic('select');
    setActive(i);
  }, []);
  const emitEnd = useCallback(() => {
    setActive(null);
    handlers.current.onEnd?.();
  }, []);

  const band = useSharedValue(-1);
  const startDb = useSharedValue(0);
  const lastDb = useSharedValue(0);

  const nearest = (x: number) => {
    'worklet';
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < bandXs.length; i++) {
      const d = Math.abs(bandXs[i] - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };

  const pan = usePanGesture({
    minDistance: 0,
    onActivate: (e) => {
      'worklet';
      const i = nearest(e.x);
      band.set(i);
      const g = gains.get()[i] ?? 0;
      startDb.set(g);
      lastDb.set(g);
      scheduleOnRN(emitStart, i);
    },
    onUpdate: (e) => {
      'worklet';
      const i = band.get();
      if (i < 0) return;
      let db = startDb.get() - (e.translationY / plotH) * RANGE * 2;
      db = Math.round(Math.min(BAND_MAX, Math.max(-BAND_MAX, db)) * 2) / 2;
      if (Math.abs(db) < 0.5) db = 0;
      const prev = lastDb.get();
      if (db === prev) return;
      lastDb.set(db);
      const crossed = Math.floor(db / 3) !== Math.floor(prev / 3) || db === 0 || Math.abs(db) === BAND_MAX;
      scheduleOnRN(emitBand, i, db, crossed);
    },
    onDeactivate: () => {
      'worklet';
      band.set(-1);
      scheduleOnRN(emitEnd);
    },
  });

  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    maxDelay: 280,
    maxDistance: 16,
    onActivate: (e) => {
      'worklet';
      scheduleOnRN(emitBand, nearest(e.x), 0, true);
    },
  });

  const gesture = useSimultaneousGestures(pan, doubleTap);

  const spectrum = useAnimatedProps(() => {
    const v = spectrumBands.get();
    let d = `M${spectrumXs[0]},${bottomY}`;
    for (let i = 0; i < spectrumXs.length; i++) {
      d += `L${spectrumXs[i]},${bottomY - Math.min(1, v[i] ?? 0) * plotH * 0.92}`;
    }
    d += `L${spectrumXs[spectrumXs.length - 1]},${bottomY}Z`;
    return { d };
  });

  const curve = width > 0 ? curveDb(params, CURVE_FREQS) : [];
  let line = '';
  curve.forEach((db, i) => {
    line += `${i ? 'L' : 'M'}${xOf(CURVE_FREQS[i]).toFixed(1)},${yOf(db).toFixed(1)}`;
  });
  const area = line ? `${line}L${xOf(20000)},${zeroY}L${xOf(20)},${zeroY}Z` : '';
  const tint = muted ? c.ink4 : c.accent;
  const activeDb = active !== null ? (params.bands[active] ?? 0) : 0;

  return (
    <View style={styles.wrap}>
      <View style={[styles.readout, { backgroundColor: active !== null ? c.fillStrong : 'transparent' }]} pointerEvents="none">
        <T variant="mono" color={active !== null ? 'ink' : 'ink4'} tabular>
          {active !== null ? `${bandLabel(EQ_BANDS[active])} Hz  ${formatDb(activeDb)}` : 'Drag a band · double-tap to zero'}
        </T>
      </View>
      <GestureDetector gesture={gesture}>
        <View
          style={[styles.canvas, { height: H, backgroundColor: c.surface2, borderColor: c.line }]}
          onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
          testID="eq-graph">
          {width > 0 ? (
            <Svg width={width} height={H}>
              <Defs>
                <LinearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={tint} stopOpacity={muted ? 0.12 : 0.34} />
                  <Stop offset="1" stopColor={tint} stopOpacity={0.02} />
                </LinearGradient>
              </Defs>
              {[12, 6, -6, -12].map((db) => (
                <Line key={db} x1={PAD_X} x2={width - PAD_X} y1={yOf(db)} y2={yOf(db)} stroke={c.line} strokeWidth={1} strokeDasharray="2 5" />
              ))}
              {[100, 1000, 10000].map((f) => (
                <Line key={f} x1={xOf(f)} x2={xOf(f)} y1={TOP} y2={bottomY} stroke={c.line} strokeWidth={1} />
              ))}
              <Line x1={PAD_X} x2={width - PAD_X} y1={zeroY} y2={zeroY} stroke={c.lineStrong} strokeWidth={1} />
              {[12, -12].map((db) => (
                <SvgText key={db} x={width - PAD_X} y={yOf(db) - 4} fill={c.ink4} fontSize={9} fontFamily={fonts.mono} textAnchor="end">
                  {db > 0 ? `+${db}` : db}
                </SvgText>
              ))}
              <AnimatedPath animatedProps={spectrum} fill={withAlpha('#FFFFFF', 0.07)} />
              <Path d={area} fill="url(#eqFill)" />
              <Path d={line} stroke={tint} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
              {EQ_BANDS.map((f, i) => {
                const on = active === i;
                const gain = params.bands[i] ?? 0;
                return (
                  <Circle
                    key={f}
                    cx={bandXs[i]}
                    cy={yOf(gain)}
                    r={on ? 10 : 6.5}
                    fill={on ? tint : c.surface2}
                    stroke={gain === 0 && !on ? c.ink4 : tint}
                    strokeWidth={2.25}
                  />
                );
              })}
              {EQ_BANDS.map((f, i) => (
                <SvgText
                  key={`l${f}`}
                  x={bandXs[i]}
                  y={H - 9}
                  fill={active === i ? c.ink : c.ink4}
                  fontSize={9}
                  fontFamily={fonts.mono}
                  textAnchor="middle">
                  {bandLabel(f)}
                </SvgText>
              ))}
            </Svg>
          ) : null}
          {width > 0
            ? EQ_BANDS.map((f, i) => (
                <View
                  key={f}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={`${bandLabel(f)} hertz`}
                  accessibilityValue={{ text: formatDb(params.bands[i] ?? 0) }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={(e) => {
                    const step = e.nativeEvent.actionName === 'increment' ? 1 : -1;
                    onBand(i, Math.min(BAND_MAX, Math.max(-BAND_MAX, (params.bands[i] ?? 0) + step)));
                  }}
                  pointerEvents="none"
                  style={[styles.a11yBand, { left: bandXs[i] - 14 }]}
                />
              ))
            : null}
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  readout: { alignSelf: 'center', paddingHorizontal: space.md, height: 26, borderRadius: radius.pill, justifyContent: 'center' },
  canvas: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  a11yBand: { position: 'absolute', top: 0, bottom: 0, width: 28 },
});
