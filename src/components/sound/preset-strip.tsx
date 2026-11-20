import { useRef } from 'react';
import { ScrollView, StyleSheet, type ScrollViewInstance } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { Press } from '../press';
import { T } from '../text';
import { withAlpha } from '@/lib/color';
import { applyPreset, curveDb, FLAT_SOUND, logFreqs, PRESETS } from '@/lib/eq';
import type { SoundPreset } from '@/lib/types';
import { applySoundPreset } from '@/stores/sound';
import { radius, space, useTheme } from '@/theme';

const PLOT_W = 112;
const PLOT_H = 46;
const TILE_W = PLOT_W + space.md * 2;
const GAP = space.sm;
const RANGE = 12;
const FREQS = logFreqs(40, 20, 20000);

type Curve = { line: string; area: string };

let curves: Map<string, Curve> | null = null;

/** Each preset's tone curve, drawn once and reused; presets never change at runtime. */
function presetCurves(): Map<string, Curve> {
  if (curves) return curves;
  const mid = PLOT_H / 2;
  const span = mid - 4;
  curves = new Map(
    PRESETS.map((p) => {
      const db = curveDb(applyPreset(FLAT_SOUND, p), FREQS);
      let line = '';
      db.forEach((v, i) => {
        const x = (i / (FREQS.length - 1)) * PLOT_W;
        const y = mid - (Math.max(-RANGE, Math.min(RANGE, v)) / RANGE) * span;
        line += `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      });
      return [p.id, { line, area: `${line}L${PLOT_W},${mid}L0,${mid}Z` }];
    }),
  );
  return curves;
}

function PresetTile({ preset, selected }: { preset: SoundPreset; selected: boolean }) {
  const c = useTheme();
  const curve = presetCurves().get(preset.id);
  const tint = selected ? c.accent : c.ink3;
  return (
    <Press
      onPress={() => applySoundPreset(preset)}
      haptic="select"
      scale={0.95}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      accessibilityLabel={`${preset.name} preset. ${preset.blurb}`}
      testID={`preset-${preset.id}`}
      style={[
        styles.tile,
        {
          backgroundColor: selected ? withAlpha(c.accent, 0.1) : c.surface,
          borderColor: selected ? withAlpha(c.accent, 0.7) : c.line,
        },
      ]}>
      <Svg width={PLOT_W} height={PLOT_H}>
        <Line x1={0} x2={PLOT_W} y1={PLOT_H / 2} y2={PLOT_H / 2} stroke={c.lineStrong} strokeWidth={1} strokeDasharray="2 4" />
        {curve ? (
          <>
            <Path d={curve.area} fill={tint} fillOpacity={selected ? 0.2 : 0.08} />
            <Path d={curve.line} stroke={tint} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : null}
      </Svg>
      <T variant="calloutMedium" color={selected ? 'ink' : 'ink2'} numberOfLines={1}>
        {preset.name}
      </T>
    </Press>
  );
}

/** Every preset as a tile with its curve, so you can see the sound before you hear it. */
export function PresetStrip({ selectedId }: { selectedId: string | null }) {
  const ref = useRef<ScrollViewInstance>(null);
  const placed = useRef(false);

  // On first layout, bring the active preset into view (the list is longer than the screen).
  const onLayout = () => {
    if (placed.current) return;
    placed.current = true;
    const i = PRESETS.findIndex((p) => p.id === selectedId);
    if (i > 1) ref.current?.scrollTo({ x: (i - 1) * (TILE_W + GAP), animated: false });
  };

  return (
    <ScrollView
      ref={ref}
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      onLayout={onLayout}
      accessibilityRole="radiogroup"
      accessibilityLabel="Sound presets"
      contentContainerStyle={styles.strip}
      testID="sound-presets">
      {PRESETS.map((p) => (
        <PresetTile key={p.id} preset={p} selected={p.id === selectedId} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: space.page, gap: GAP },
  tile: {
    width: TILE_W,
    padding: space.md,
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
