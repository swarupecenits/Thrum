import { memo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Cover, MosaicCover } from './cover';
import { NowBars } from './now-bars';
import { T } from './text';
import type { Library, Track } from '@/lib/types';
import { useLibrary } from '@/stores/library';
import { usePlayer } from '@/stores/player';
import { openSheet } from '@/stores/ui';
import { space } from '@/theme';
import { haptic } from '@/utils/haptics';

/** Up to `n` covers from distinct albums, for mosaics. */
export function coverTiles(lib: Library, trackIds: readonly string[], n = 4): { albumId: string; trackId: string; label: string }[] {
  const out: { albumId: string; trackId: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const id of trackIds) {
    const t = lib.byId.get(id);
    if (!t || seen.has(t.albumId)) continue;
    seen.add(t.albumId);
    out.push({ albumId: t.albumId, trackId: t.id, label: t.album });
    if (out.length >= n) break;
  }
  return out;
}

/** A horizontal row of cards that runs edge to edge and snaps gently. */
export function Shelf({ children, gap = space.md, testID }: { children: ReactNode; gap?: number; testID?: string }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      decelerationRate="fast"
      contentContainerStyle={[styles.shelf, { gap }]}
      testID={testID}>
      {children}
    </ScrollView>
  );
}

type TrackCardProps = {
  track: Track;
  size: number;
  onPress: () => void;
  caption?: string;
  testID?: string;
};

function TrackCardBase({ track, size, onPress, caption, testID }: TrackCardProps) {
  const current = usePlayer((s) => s.trackId === track.id);
  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => {
        haptic('soft');
        openSheet({ kind: 'track', trackId: track.id });
      }}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={`${track.title}, ${track.artist}`}
      accessibilityHint="Plays. Long press for options."
      testID={testID}
      style={({ pressed }) => [{ width: size, opacity: pressed ? 0.75 : 1 }]}>
      <View>
        <Cover albumId={track.albumId} trackId={track.id} label={track.album} size={size} />
        {current ? (
          <View style={styles.badge}>
            <NowBars size={14} />
          </View>
        ) : null}
      </View>
      <T variant="calloutMedium" color={current ? 'accent' : 'ink'} numberOfLines={1} style={styles.title}>
        {track.title}
      </T>
      <T variant="small" color="ink3" numberOfLines={1}>
        {caption ?? track.artist}
      </T>
    </Pressable>
  );
}

/** Square cover with title and artist; long-press opens the track menu. */
export const TrackCard = memo(TrackCardBase);

type MixCardProps = {
  title: string;
  subtitle: string;
  trackIds: readonly string[];
  seed: string;
  size: number;
  onPress: () => void;
  testID?: string;
};

function MixCardBase({ title, subtitle, trackIds, seed, size, onPress, testID }: MixCardProps) {
  const lib = useLibrary((s) => s.lib);
  const tiles = coverTiles(lib, trackIds);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}`}
      testID={testID}
      style={({ pressed }) => [{ width: size, opacity: pressed ? 0.75 : 1 }]}>
      <MosaicCover tiles={tiles} seed={seed} label={title} size={size} />
      <T variant="calloutMedium" numberOfLines={1} style={styles.title}>
        {title}
      </T>
      <T variant="small" color="ink3" numberOfLines={1}>
        {subtitle}
      </T>
    </Pressable>
  );
}

/** A mosaic of a mix's covers with its name: playlists, "On repeat" and other generated lists. */
export const MixCard = memo(MixCardBase);

const styles = StyleSheet.create({
  shelf: { paddingHorizontal: space.page },
  title: { marginTop: space.sm },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
