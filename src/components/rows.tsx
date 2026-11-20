import { router } from 'expo-router';
import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Cover, MosaicCover } from './cover';
import { Icon, type IconName } from './icon';
import { NowBars } from './now-bars';
import { surfaceRole } from './press';
import { T } from './text';
import { formatDuration } from '@/lib/format';
import type { Album, Artist, Track } from '@/lib/types';
import { useCollections } from '@/stores/collections';
import { useLibrary } from '@/stores/library';
import { usePlayer } from '@/stores/player';
import { openSheet, type SheetState } from '@/stores/ui';
import { radius, space, useBase } from '@/theme';
import { haptic } from '@/utils/haptics';

export const TRACK_ROW_H = 64;

type TrackMenu = Omit<Extract<SheetState, { kind: 'track' }>, 'kind' | 'trackId'>;

type TrackRowProps = {
  track: Track;
  index: number;
  onPlay: (index: number) => void;
  /** Album view: a track number column instead of artwork. */
  number?: number | null;
  subtitle?: string;
  /** Extra context for the long-press menu (playlist or queue position). */
  menu?: TrackMenu;
  trailing?: ReactNode;
  /** Extra right padding, e.g. to clear a fast-scroll index. */
  gutter?: number;
  testID?: string;
};

function openTrackMenu(trackId: string, menu?: TrackMenu) {
  haptic('soft');
  openSheet({ kind: 'track', trackId, ...menu });
}

/** A light "more" button for list rows (theme-only subscription, no spring) so long lists stay cheap. */
function RowMore({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useBase();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.more, pressed && { backgroundColor: c.fill }]}>
      <Icon name="dots-three-vertical" size={20} color={c.ink3} weight="bold" />
    </Pressable>
  );
}

function TrackRowBase({ track, index, onPlay, number, subtitle, menu, trailing, gutter, testID }: TrackRowProps) {
  const c = useBase();
  const current = usePlayer((s) => s.trackId === track.id);
  const favorite = useCollections((s) => s.favorites.has(track.id));
  const numbered = number !== undefined;
  return (
    <Pressable
      onPress={() => onPlay(index)}
      onLongPress={() => openTrackMenu(track.id, menu)}
      delayLongPress={320}
      accessibilityRole="button"
      role={surfaceRole}
      accessibilityLabel={`${track.title}, ${track.artist}${current ? ', now playing' : ''}`}
      accessibilityHint="Plays. Long press for options."
      testID={testID}
      style={({ pressed }) => [styles.row, gutter ? { paddingRight: space.sm + gutter } : null, pressed && { backgroundColor: c.fill }]}>
      {numbered ? (
        <View style={styles.number}>
          {current ? (
            <NowBars size={14} />
          ) : (
            <T variant="mono" color="ink4" tabular>
              {number ?? '·'}
            </T>
          )}
        </View>
      ) : (
        <View>
          <Cover albumId={track.albumId} trackId={track.id} label={track.album} size={48} rounded={8} />
          {current ? (
            <View style={[styles.coverOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
              <NowBars size={16} />
            </View>
          ) : null}
        </View>
      )}
      <View style={styles.text}>
        <T variant="bodyMedium" color={current ? 'accent' : 'ink'} numberOfLines={1}>
          {track.title}
        </T>
        <View style={styles.subRow}>
          {favorite ? <Icon name="heart" size={11} weight="fill" color={c.ink3} /> : null}
          <T variant="small" color="ink3" numberOfLines={1} style={styles.flex}>
            {subtitle ?? (numbered ? `${track.artist} · ${formatDuration(track.durationMs)}` : `${track.artist} · ${track.album}`)}
          </T>
        </View>
      </View>
      {trailing ?? <RowMore label={`More for ${track.title}`} onPress={() => openTrackMenu(track.id, menu)} />}
    </Pressable>
  );
}

export const TrackRow = memo(TrackRowBase);

type AlbumTileProps = { album: Album; size: number; testID?: string; subtitle?: string };

function AlbumTileBase({ album, size, subtitle, testID }: AlbumTileProps) {
  const playingHere = usePlayer((s) => s.trackId !== null && album.trackIds.includes(s.trackId));
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/album/[id]', params: { id: album.id } })}
      onLongPress={() => {
        haptic('soft');
        openSheet({ kind: 'album', albumId: album.id });
      }}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={`${album.title}, album by ${album.artist}`}
      testID={testID}
      style={({ pressed }) => [{ width: size, opacity: pressed ? 0.75 : 1 }]}>
      <View>
        <Cover albumId={album.id} trackId={album.coverTrackId} label={album.title} size={size} art={size > 160 ? 'lg' : 'sm'} />
        {playingHere ? (
          <View style={styles.tileBadge}>
            <NowBars size={14} />
          </View>
        ) : null}
      </View>
      <T variant="calloutMedium" numberOfLines={1} style={styles.tileTitle}>
        {album.title}
      </T>
      <T variant="small" color="ink3" numberOfLines={1}>
        {subtitle ?? (album.year ? `${album.artist} · ${album.year}` : album.artist)}
      </T>
    </Pressable>
  );
}

export const AlbumTile = memo(AlbumTileBase);

function ArtistRowBase({ artist, gutter, testID }: { artist: Artist; gutter?: number; testID?: string }) {
  const c = useBase();
  const lib = useLibrary((s) => s.lib);
  const album = artist.albumIds[0] ? lib.albumById.get(artist.albumIds[0]) : undefined;
  const albums = artist.albumIds.length;
  const tracks = artist.trackIds.length;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/artist/[id]', params: { id: artist.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${artist.name}, artist`}
      testID={testID}
      style={({ pressed }) => [styles.row, gutter ? { paddingRight: space.sm + gutter } : null, pressed && { backgroundColor: c.fill }]}>
      {album ? (
        <Cover albumId={album.id} trackId={album.coverTrackId} label={artist.name} size={48} rounded={24} seed={artist.id} />
      ) : (
        <View style={[styles.round, { backgroundColor: c.surface2 }]}>
          <Icon name="microphone-stage" size={20} color={c.ink3} />
        </View>
      )}
      <View style={styles.text}>
        <T variant="bodyMedium" numberOfLines={1}>
          {artist.name}
        </T>
        <T variant="small" color="ink3" numberOfLines={1}>
          {albums > 1 ? `${albums} albums · ` : ''}
          {tracks === 1 ? '1 track' : `${tracks} tracks`}
        </T>
      </View>
      <Icon name="caret-right" size={16} color={c.ink4} />
    </Pressable>
  );
}

export const ArtistRow = memo(ArtistRowBase);

type CollectionRowProps = {
  title: string;
  subtitle: string;
  /** Track ids whose covers make the mosaic; or an icon when there's nothing to show. */
  trackIds?: string[];
  icon?: IconName;
  seed: string;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  gutter?: number;
  testID?: string;
};

function CollectionRowBase({ title, subtitle, trackIds, icon, seed, onPress, onLongPress, accessibilityLabel, gutter, testID }: CollectionRowProps) {
  const c = useBase();
  const lib = useLibrary((s) => s.lib);
  const tiles: { albumId: string; trackId: string; label: string }[] = [];
  if (trackIds) {
    const seen = new Set<string>();
    for (const id of trackIds) {
      const t = lib.byId.get(id);
      if (!t || seen.has(t.albumId)) continue;
      seen.add(t.albumId);
      tiles.push({ albumId: t.albumId, trackId: t.id, label: t.album });
      if (tiles.length === 4) break;
    }
  }
  return (
    <Pressable
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              haptic('soft');
              onLongPress();
            }
          : undefined
      }
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${title}, ${subtitle}`}
      testID={testID}
      style={({ pressed }) => [styles.row, gutter ? { paddingRight: space.sm + gutter } : null, pressed && { backgroundColor: c.fill }]}>
      {icon && tiles.length === 0 ? (
        <View style={[styles.square, { backgroundColor: c.surface2 }]}>
          <Icon name={icon} size={22} color={c.ink2} weight="duotone" />
        </View>
      ) : (
        <MosaicCover tiles={tiles} seed={seed} label={title} size={48} rounded={8} />
      )}
      <View style={styles.text}>
        <T variant="bodyMedium" numberOfLines={1}>
          {title}
        </T>
        <T variant="small" color="ink3" numberOfLines={1}>
          {subtitle}
        </T>
      </View>
      <Icon name="caret-right" size={16} color={c.ink4} />
    </Pressable>
  );
}

export const CollectionRow = memo(CollectionRowBase);

const styles = StyleSheet.create({
  row: {
    height: TRACK_ROW_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingLeft: space.page,
    paddingRight: space.sm,
  },
  flex: { flex: 1 },
  number: { width: 28, alignItems: 'center', justifyContent: 'center' },
  coverOverlay: { ...StyleSheet.absoluteFill, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, gap: 2, justifyContent: 'center' },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  more: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  round: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  square: { width: 48, height: 48, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  tileTitle: { marginTop: space.sm },
  tileBadge: {
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
