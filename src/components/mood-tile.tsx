import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from './icon';
import { Press } from './press';
import { T } from './text';
import { isDark, mix, withAlpha } from '@/lib/color';
import type { Mood, MoodId } from '@/lib/types';
import { radius, space } from '@/theme';

export const MOOD_ICONS: Record<MoodId, IconName> = {
  chill: 'leaf',
  energetic: 'lightning',
  happy: 'smiley',
  sad: 'heart-break',
  romantic: 'hand-heart',
  focus: 'brain',
  party: 'confetti',
  workout: 'barbell',
  latenight: 'moon',
  devotional: 'flower-lotus',
  bass: 'speaker-hifi',
  acoustic: 'guitar',
  drive: 'steering-wheel',
  sleep: 'bed',
};

/** Readable ink for text laid over a mood gradient. */
export function moodInk(mood: Mood): string {
  return isDark(mix(mood.color, mood.color2, 0.5)) ? '#FAFAFA' : '#0B0B0D';
}

type MoodTileProps = {
  mood: Mood;
  width: number;
  height: number;
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
};

/** A mood as a gradient card with an oversized, tilted glyph bleeding off the corner. */
function MoodTileBase({ mood, width, height, subtitle, onPress, onLongPress, testID }: MoodTileProps) {
  const ink = moodInk(mood);
  const glyph = Math.round(Math.min(width, height) * 0.78);
  return (
    <Press
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={320}
      haptic="tap"
      accessibilityLabel={`${mood.label}. ${subtitle ?? mood.blurb}`}
      testID={testID}
      style={[styles.tile, { width, height }]}>
      <LinearGradient colors={[mood.color, mood.color2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={[styles.glyph, { right: -glyph * 0.22, bottom: -glyph * 0.2 }]}>
        <Icon name={MOOD_ICONS[mood.id]} size={glyph} color={withAlpha(ink, 0.16)} weight="fill" />
      </View>
      <View style={styles.body}>
        <T variant="serif" color={ink} numberOfLines={1}>
          {mood.label}
        </T>
        <T variant="small" color={withAlpha(ink, 0.78)} numberOfLines={2}>
          {subtitle ?? mood.blurb}
        </T>
      </View>
    </Press>
  );
}

export const MoodTile = memo(MoodTileBase);

const styles = StyleSheet.create({
  tile: { borderRadius: radius.lg, overflow: 'hidden', justifyContent: 'flex-end' },
  glyph: { position: 'absolute', transform: [{ rotate: '-14deg' }] },
  body: { padding: space.md, paddingRight: space.lg, gap: 2 },
});
