import { StyleSheet, View } from 'react-native';

import { IconButton } from '../buttons';
import { Cover, MosaicCover } from '../cover';
import { go } from '../nav';
import { MenuDivider, MenuItem, SheetHeader } from '../sheet';
import { T } from '../text';
import { artistIdOf, VARIOUS_ARTISTS } from '@/lib/library';
import { formatCount, formatTotalDuration } from '@/lib/format';
import type { Track } from '@/lib/types';
import {
  deletePlaylist,
  removeFromPlaylist,
  restorePlaylist,
  setPlaylistTracks,
  toggleFavorite,
  useCollections,
} from '@/stores/collections';
import { useLibrary } from '@/stores/library';
import { player, usePlayer, type PlaySource } from '@/stores/player';
import { toast } from '@/stores/toast';
import { closeSheet, openSheet, type SheetState } from '@/stores/ui';
import { space, useTheme } from '@/theme';

export const FAVORITES_ID = 'favorites';

function Unavailable({ what }: { what: string }) {
  return (
    <View style={styles.unavailable}>
      <T variant="headline">{`This ${what} isn't available`}</T>
      <T variant="callout" color="ink3">
        It may have been moved or deleted from your phone.
      </T>
    </View>
  );
}

function queued(count: number, next: boolean) {
  if (!count) return;
  closeSheet();
  toast({
    message: next ? (count === 1 ? 'Playing next' : `${count} tracks playing next`) : count === 1 ? 'Added to queue' : `${count} tracks added to queue`,
    icon: next ? 'arrow-bend-up-right' : 'queue',
  });
}

function playAll(ids: string[], source: PlaySource, shuffle = false) {
  closeSheet();
  player.playIds(ids, shuffle ? -1 : 0, { source, shuffle });
}

/** Play / shuffle / queue actions shared by every collection menu. */
function CollectionActions({ ids, source }: { ids: string[]; source: PlaySource }) {
  const empty = ids.length === 0;
  return (
    <>
      <MenuItem icon="play" label="Play" disabled={empty} onPress={() => playAll(ids, source)} />
      <MenuItem icon="shuffle" label="Shuffle" disabled={empty} onPress={() => playAll(ids, source, true)} />
      <MenuItem icon="arrow-bend-up-right" label="Play next" disabled={empty} onPress={() => queued(player.playNext(ids), true)} />
      <MenuItem icon="queue" label="Add to queue" disabled={empty} onPress={() => queued(player.addToQueue(ids), false)} />
      <MenuItem
        icon="list-plus"
        label="Add to playlist"
        disabled={empty}
        onPress={() => openSheet({ kind: 'add-to-playlist', trackIds: ids })}
      />
    </>
  );
}

type TrackSheetProps = Omit<Extract<SheetState, { kind: 'track' }>, 'kind'>;

export function TrackSheet({ trackId, playlistId, playlistIndex, queueIndex }: TrackSheetProps) {
  const c = useTheme();
  const track = useLibrary((s) => s.lib.byId.get(trackId));
  const favorite = useCollections((s) => s.favorites.has(trackId));
  const playlistName = useCollections((s) => (playlistId ? s.playlists.find((p) => p.id === playlistId)?.name : undefined));
  const isCurrent = usePlayer((s) => s.trackId === trackId);
  if (!track) return <Unavailable what="track" />;
  const artist = track.artists[0] ?? track.artist;

  const removeFromList = () => {
    if (!playlistId || playlistIndex === undefined) return;
    const before = useCollections.getState().playlists.find((p) => p.id === playlistId)?.trackIds;
    if (!removeFromPlaylist(playlistId, playlistIndex)) return;
    closeSheet();
    toast({
      message: `Removed from ${playlistName ?? 'playlist'}`,
      icon: 'minus',
      action: before ? { label: 'Undo', onPress: () => setPlaylistTracks(playlistId, before) } : undefined,
    });
  };

  return (
    <>
      <SheetHeader
        leading={<Cover albumId={track.albumId} trackId={track.id} label={track.album} size={52} rounded={10} />}
        title={track.title}
        subtitle={`${track.artist} · ${track.album}`}
        trailing={
          <IconButton
            icon="heart"
            weight={favorite ? 'fill' : 'regular'}
            color={favorite ? c.accent : c.ink2}
            label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            haptic="soft"
            onPress={() => toggleFavorite(track.id)}
          />
        }
      />
      {isCurrent ? null : (
        <MenuItem icon="arrow-bend-up-right" label="Play next" onPress={() => queued(player.playNext([track.id]), true)} />
      )}
      <MenuItem icon="queue" label="Add to queue" onPress={() => queued(player.addToQueue([track.id]), false)} />
      <MenuItem icon="list-plus" label="Add to playlist" onPress={() => openSheet({ kind: 'add-to-playlist', trackIds: [track.id] })} />
      <MenuItem
        icon="magic-wand"
        label="Songs like this"
        detail="A mix that sounds like it"
        onPress={() => go({ pathname: '/mix/[id]', params: { id: `similar-${track.id}` } })}
      />
      <MenuDivider />
      <MenuItem icon="disc" label="Go to album" detail={track.album} onPress={() => go({ pathname: '/album/[id]', params: { id: track.albumId } })} />
      <MenuItem
        icon="microphone-stage"
        label="Go to artist"
        detail={artist}
        onPress={() => go({ pathname: '/artist/[id]', params: { id: artistIdOf(artist) } })}
      />
      <MenuItem icon="info" label="Track info" detail="Format, tempo, key, plays" onPress={() => openSheet({ kind: 'track-info', trackId })} />
      {playlistId && playlistIndex !== undefined ? (
        <MenuItem icon="minus" tone="danger" label="Remove from playlist" detail={playlistName} onPress={removeFromList} />
      ) : null}
      {queueIndex !== undefined && !isCurrent ? (
        <MenuItem
          icon="x"
          tone="danger"
          label="Remove from queue"
          onPress={() => {
            player.removeAt(queueIndex);
            closeSheet();
          }}
        />
      ) : null}
    </>
  );
}

export function AlbumSheet({ albumId }: { albumId: string }) {
  const album = useLibrary((s) => s.lib.albumById.get(albumId));
  if (!album) return <Unavailable what="album" />;
  const meta = [album.artist, album.year, formatCount(album.trackIds.length, 'track')].filter(Boolean).join(' · ');
  return (
    <>
      <SheetHeader
        leading={<Cover albumId={album.id} trackId={album.coverTrackId} label={album.title} size={52} rounded={10} />}
        title={album.title}
        subtitle={meta}
      />
      <CollectionActions ids={album.trackIds} source={{ kind: 'album', id: album.id, label: album.title }} />
      {album.artist !== VARIOUS_ARTISTS ? (
        <>
          <MenuDivider />
          <MenuItem
            icon="microphone-stage"
            label="Go to artist"
            detail={album.artist}
            onPress={() => go({ pathname: '/artist/[id]', params: { id: artistIdOf(album.artist) } })}
          />
        </>
      ) : null}
    </>
  );
}

function mosaicTiles(ids: string[], byId: Map<string, Track>) {
  const tiles: { albumId: string; trackId: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const t = byId.get(id);
    if (!t || seen.has(t.albumId)) continue;
    seen.add(t.albumId);
    tiles.push({ albumId: t.albumId, trackId: t.id, label: t.album });
    if (tiles.length === 4) break;
  }
  return tiles;
}

export function PlaylistSheet({ playlistId }: { playlistId: string }) {
  const byId = useLibrary((s) => s.lib.byId);
  const isFavorites = playlistId === FAVORITES_ID;
  const playlist = useCollections((s) => (isFavorites ? null : s.playlists.find((p) => p.id === playlistId)));
  const favoriteOrder = useCollections((s) => s.favoriteOrder);
  const name = isFavorites ? 'Favourites' : playlist?.name;
  const ids = (isFavorites ? favoriteOrder : (playlist?.trackIds ?? [])).filter((id) => byId.has(id));
  if (!name) return <Unavailable what="playlist" />;
  let total = 0;
  for (const id of ids) total += byId.get(id)?.durationMs ?? 0;

  const remove = () => {
    const removed = deletePlaylist(playlistId);
    if (!removed) return;
    closeSheet();
    toast({ message: `Deleted ${removed.name}`, icon: 'trash', action: { label: 'Undo', onPress: () => restorePlaylist(removed) } });
  };

  return (
    <>
      <SheetHeader
        leading={<MosaicCover tiles={mosaicTiles(ids, byId)} seed={playlistId} label={name} size={52} rounded={10} />}
        title={name}
        subtitle={ids.length ? `${formatCount(ids.length, 'track')} · ${formatTotalDuration(total)}` : 'Empty'}
      />
      <CollectionActions ids={ids} source={{ kind: isFavorites ? 'favorites' : 'playlist', id: playlistId, label: name }} />
      {isFavorites ? null : (
        <>
          <MenuDivider />
          <MenuItem icon="pencil-simple" label="Rename" onPress={() => openSheet({ kind: 'rename-playlist', playlistId })} />
          <MenuItem icon="trash" label="Delete playlist" tone="danger" onPress={remove} />
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  unavailable: { gap: space.xs, paddingVertical: space.lg },
});
