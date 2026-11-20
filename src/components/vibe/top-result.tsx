import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '../buttons';
import { Cover, MosaicCover } from '../cover';
import { Icon } from '../icon';
import { go } from '../nav';
import { Press, surfaceRole } from '../press';
import { coverTiles } from '../shelf';
import { T } from '../text';
import { formatCount } from '@/lib/format';
import { artistTracks, genreTracks, sortTracks } from '@/lib/library';
import { normalize, sortKey } from '@/lib/text';
import type { Album, Artist, Genre, Library, Playlist, SearchResults, Track } from '@/lib/types';
import { player, usePlayer, type PlaySource } from '@/stores/player';
import { radius, space, useBase } from '@/theme';

export type TopItem =
  | { kind: 'track'; id: string; name: string; track: Track }
  | { kind: 'album'; id: string; name: string; album: Album }
  | { kind: 'artist'; id: string; name: string; artist: Artist }
  | { kind: 'playlist'; id: string; name: string; playlist: Playlist }
  | { kind: 'genre'; id: string; name: string; genre: Genre };

/** The search's best hit as something the screen can show; null when there's none (or it just vanished). */
export function resolveTop(results: SearchResults, lib: Library): TopItem | null {
  const hit = results.top;
  if (!hit) return null;
  switch (hit.kind) {
    case 'track': {
      const track = lib.byId.get(hit.id);
      return track ? { kind: 'track', id: track.id, name: track.title, track } : null;
    }
    case 'album': {
      const album = lib.albumById.get(hit.id);
      return album ? { kind: 'album', id: album.id, name: album.title, album } : null;
    }
    case 'artist': {
      const artist = lib.artistById.get(hit.id);
      return artist ? { kind: 'artist', id: artist.id, name: artist.name, artist } : null;
    }
    case 'playlist': {
      const playlist = results.playlists.find((p) => p.id === hit.id);
      return playlist ? { kind: 'playlist', id: playlist.id, name: playlist.name, playlist } : null;
    }
    case 'genre': {
      const genre = results.genres.find((g) => g.id === hit.id);
      return genre ? { kind: 'genre', id: genre.id, name: genre.name, genre } : null;
    }
    default:
      return null;
  }
}

/** The whole name typed out, give or take case, accents and a leading "the". */
export function isExactName(top: TopItem, query: string): boolean {
  return sortKey(top.name) === sortKey(query) || normalize(top.name) === normalize(query);
}

function topTracks(top: TopItem, lib: Library): { ids: string[]; source: PlaySource } {
  switch (top.kind) {
    case 'track':
      return { ids: [top.id], source: { kind: 'search', label: top.name } };
    case 'album':
      return { ids: top.album.trackIds, source: { kind: 'album', id: top.id, label: top.name } };
    case 'artist':
      return {
        ids: sortTracks(artistTracks(lib, top.id), 'album').map((t) => t.id),
        source: { kind: 'artist', id: top.id, label: top.name },
      };
    case 'playlist':
      return { ids: top.playlist.trackIds, source: { kind: 'playlist', id: top.id, label: top.name } };
    case 'genre':
      return {
        ids: sortTracks(genreTracks(lib, top.id), 'artist').map((t) => t.id),
        source: { kind: 'genre', id: top.id, label: top.name },
      };
  }
}

function open(top: TopItem) {
  switch (top.kind) {
    case 'album':
      go({ pathname: '/album/[id]', params: { id: top.id } });
      return;
    case 'artist':
      go({ pathname: '/artist/[id]', params: { id: top.id } });
      return;
    case 'playlist':
      go({ pathname: '/playlist/[id]', params: { id: top.id } });
      return;
    case 'genre':
      go({ pathname: '/genre/[id]', params: { id: top.id } });
      return;
  }
}

const KIND_LABEL: Record<TopItem['kind'], string> = {
  track: 'Song',
  album: 'Album',
  artist: 'Artist',
  playlist: 'Playlist',
  genre: 'Genre',
};

function detailOf(top: TopItem): string {
  switch (top.kind) {
    case 'track':
      return top.track.artist;
    case 'album':
      return top.album.year ? `${top.album.artist} \u00b7 ${top.album.year}` : top.album.artist;
    case 'artist':
      return formatCount(top.artist.trackIds.length, 'song');
    case 'playlist':
      return formatCount(top.playlist.trackIds.length, 'song');
    case 'genre':
      return formatCount(top.genre.trackIds.length, 'song');
  }
}

const ART = 88;

function Art({ top, lib }: { top: TopItem; lib: Library }) {
  const c = useBase();
  switch (top.kind) {
    case 'track':
      return <Cover albumId={top.track.albumId} trackId={top.id} label={top.track.album} size={ART} rounded={radius.sm} />;
    case 'album':
      return <Cover albumId={top.id} trackId={top.album.coverTrackId} label={top.name} size={ART} rounded={radius.sm} />;
    case 'artist': {
      const album = top.artist.albumIds[0] ? lib.albumById.get(top.artist.albumIds[0]) : undefined;
      return album ? (
        <Cover albumId={album.id} trackId={album.coverTrackId} label={top.name} size={ART} rounded={ART / 2} seed={top.id} />
      ) : (
        <View style={[styles.round, { backgroundColor: c.surface2 }]}>
          <Icon name="microphone-stage" size={32} color={c.ink3} />
        </View>
      );
    }
    case 'playlist':
      return <MosaicCover tiles={coverTiles(lib, top.playlist.trackIds)} seed={top.id} label={top.name} size={ART} rounded={radius.sm} />;
    case 'genre':
      return (
        <MosaicCover tiles={coverTiles(lib, top.genre.trackIds)} seed={`genre-${top.id}`} label={top.name} size={ART} rounded={radius.sm} />
      );
  }
}

type TopResultProps = {
  top: TopItem;
  lib: Library;
  /** Plays a song hit inside the song results, so the queue carries on with them. */
  onPlayTrack: (trackId: string) => void;
  /** Called when the card starts playback, so the search can be remembered. */
  onPlay?: () => void;
};

/** The one thing the words most likely mean, with a play button that does the obvious thing for its kind. */
function TopResultBase({ top, lib, onPlayTrack, onPlay }: TopResultProps) {
  const c = useBase();
  const here = usePlayer((s) => (top.kind === 'track' ? s.trackId === top.id : s.source?.kind === top.kind && s.source.id === top.id));
  const playing = usePlayer((s) => s.playWhenReady) && here;

  const play = () => {
    if (here) {
      player.toggle();
      return;
    }
    if (top.kind === 'track') {
      onPlayTrack(top.id);
      return;
    }
    const { ids, source } = topTracks(top, lib);
    if (player.playIds(ids, 0, { source })) onPlay?.();
  };

  return (
    <Press
      onPress={top.kind === 'track' ? play : () => open(top)}
      scale={0.985}
      accessibilityRole="button"
      role={surfaceRole}
      accessibilityLabel={`Top result. ${KIND_LABEL[top.kind]}: ${top.name}, ${detailOf(top)}`}
      accessibilityHint={top.kind === 'track' ? 'Plays.' : 'Opens.'}
      style={[styles.card, { backgroundColor: c.surface, borderColor: c.line }]}
      testID="vibe-top">
      <Art top={top} lib={lib} />
      <View style={styles.text}>
        <T variant="heading" numberOfLines={2}>
          {top.name}
        </T>
        <View style={styles.meta}>
          <View style={[styles.kind, { backgroundColor: c.fillStrong }]}>
            <T variant="small" color="ink2">
              {KIND_LABEL[top.kind]}
            </T>
          </View>
          <T variant="small" color="ink3" numberOfLines={1} style={styles.flex}>
            {detailOf(top)}
          </T>
        </View>
      </View>
      <IconButton
        icon={playing ? 'pause' : 'play'}
        label={playing ? `Pause ${top.name}` : `Play ${top.name}`}
        tone="accent"
        size={48}
        onPress={play}
        testID="vibe-top-play"
      />
    </Press>
  );
}

export const TopResult = memo(TopResultBase);

const styles = StyleSheet.create({
  card: {
    marginHorizontal: space.page,
    padding: space.md,
    paddingRight: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  text: { flex: 1, gap: space.xs },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kind: { paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill },
  flex: { flexShrink: 1 },
  round: { width: ART, height: ART, borderRadius: ART / 2, alignItems: 'center', justifyContent: 'center' },
});
