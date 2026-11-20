import { LinearGradient } from 'expo-linear-gradient';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '../buttons';
import { Cover } from '../cover';
import { Icon } from '../icon';
import { go } from '../nav';
import { Press, surfaceRole } from '../press';
import { coverTiles } from '../shelf';
import { T } from '../text';
import { mix } from '@/lib/color';
import { moodById } from '@/lib/moods';
import type { Daylist, Library } from '@/lib/types';
import { player, usePlayer } from '@/stores/player';
import { radius, space } from '@/theme';

const ART = 92;
const FAN = [
  { rotate: '-9deg', x: -38, y: 10, z: 1 },
  { rotate: '7deg', x: 30, y: 4, z: 2 },
  { rotate: '-1deg', x: -4, y: -6, z: 3 },
] as const;

type DaylistCardProps = { daylist: Daylist; lib: Library };

/** The daypart's mix: named for how you actually listen at this hour, refreshed every few hours. */
function DaylistCardBase({ daylist, lib }: DaylistCardProps) {
  const fromDaylist = usePlayer((s) => s.source?.kind === 'daylist');
  const playing = usePlayer((s) => s.playWhenReady && s.source?.kind === 'daylist');
  if (!daylist.trackIds.length) return null;

  const m1 = moodById(daylist.moods[0] ?? 'chill');
  const m2 = moodById(daylist.moods[1] ?? daylist.moods[0] ?? 'chill');
  const colors = [mix(m1.color, '#09090B', 0.3), mix(m2.color2, '#09090B', 0.5), '#0E0E11'] as const;
  const tiles = coverTiles(lib, daylist.trackIds, 3);

  const play = () => {
    if (fromDaylist) player.toggle();
    else player.playIds(daylist.trackIds, 0, { source: { kind: 'daylist', label: daylist.title } });
  };

  return (
    <Press
      onPress={() => go('/mix/daylist')}
      scale={0.985}
      accessibilityRole="button"
      role={surfaceRole}
      accessibilityLabel={`Daylist: ${daylist.title}. ${daylist.subtitle}`}
      style={styles.wrap}
      testID="daylist-card">
      <LinearGradient colors={colors} locations={[0, 0.62, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={styles.kicker}>
          <Icon name="sun-horizon" size={14} color="rgba(255,255,255,0.8)" weight="bold" />
          <T variant="label" color="rgba(255,255,255,0.8)">
            {`Daylist \u00b7 ${daylist.daypart.label}`}
          </T>
        </View>
        <View style={styles.body}>
          <T variant="serif" color="#FFFFFF" numberOfLines={3} style={styles.title}>
            {daylist.title}
          </T>
          <View style={styles.fan} pointerEvents="none">
            {tiles.map((t, i) => {
              const f = FAN[FAN.length - tiles.length + i];
              return (
                <Cover
                  key={t.albumId}
                  albumId={t.albumId}
                  trackId={t.trackId}
                  label={t.label}
                  size={ART}
                  rounded={radius.sm}
                  style={[
                    styles.tile,
                    { zIndex: f.z, transform: [{ translateX: f.x }, { translateY: f.y }, { rotate: f.rotate }] },
                  ]}
                />
              );
            })}
          </View>
        </View>
        <View style={styles.footer}>
          <T variant="small" color="rgba(255,255,255,0.72)" numberOfLines={1} style={styles.subtitle}>
            {daylist.subtitle}
          </T>
          <IconButton
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause daylist' : 'Play daylist'}
            tone="accent"
            size={48}
            onPress={play}
            testID="daylist-play"
          />
        </View>
      </LinearGradient>
    </Press>
  );
}

export const DaylistCard = memo(DaylistCardBase);

const styles = StyleSheet.create({
  wrap: { marginHorizontal: space.page },
  card: {
    borderRadius: radius.lg,
    padding: space.lg,
    paddingTop: space.lg,
    gap: space.md,
    minHeight: 216,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  kicker: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  body: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: space.md },
  title: { flex: 1 },
  fan: { width: ART + 36, height: ART + 20, alignItems: 'center', justifyContent: 'center' },
  tile: { position: 'absolute', boxShadow: '0 10px 24px rgba(0,0,0,0.45)' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  subtitle: { flex: 1 },
});
