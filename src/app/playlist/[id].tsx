import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { DetailScreen, MissingScreen, type DetailItem } from '@/components/collection';
import { go, openSearch } from '@/components/nav';
import { FAVORITES_ID } from '@/components/sheets/menus';
import { useClock } from '@/hooks/use-clock';
import { formatCount, formatRelative, formatTotalDuration } from '@/lib/format';
import { MINUTE_MS } from '@/lib/time';
import type { Library } from '@/lib/types';
import { useCollections } from '@/stores/collections';
import { useLibrary } from '@/stores/library';
import type { PlaySource } from '@/stores/player';
import { openSheet } from '@/stores/ui';

const FAVORITES_ART = { kind: 'gradient', colors: ['#BEF264', '#365314'], icon: 'heart' } as const;

/** Rows for the songs still on the phone; `playlistIndex` keeps pointing at the stored position for removal. */
function playlistItems(lib: Library, ids: readonly string[], playlistId: string | null) {
  const items: DetailItem[] = [];
  const playIds: string[] = [];
  let ms = 0;
  ids.forEach((trackId, at) => {
    const track = lib.byId.get(trackId);
    if (!track) return;
    ms += track.durationMs;
    items.push({
      type: 'track',
      key: `t:${trackId}:${at}`,
      track,
      index: playIds.length,
      menu: playlistId ? { playlistId, playlistIndex: at } : undefined,
    });
    playIds.push(trackId);
  });
  const missing = ids.length - playIds.length;
  if (missing > 0 && playIds.length) {
    items.push({
      type: 'note',
      key: 'n:missing',
      text: `${formatCount(missing, 'song')} from this playlist ${missing === 1 ? "isn't" : "aren't"} on your phone right now.`,
    });
  }
  return { items, playIds, ms };
}

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isFavorites = id === FAVORITES_ID;
  const lib = useLibrary((s) => s.lib);
  const playlist = useCollections((s) => (isFavorites ? undefined : s.playlists.find((p) => p.id === id)));
  const favoriteOrder = useCollections((s) => s.favoriteOrder);
  const now = useClock(MINUTE_MS);

  const ids = isFavorites ? favoriteOrder : playlist?.trackIds;
  const view = useMemo(() => {
    if (!ids) return null;
    const v = playlistItems(lib, ids, isFavorites ? null : id);
    if (!v.playIds.length) {
      v.items.push(
        isFavorites
          ? {
              type: 'empty',
              key: 'e:favorites',
              icon: 'heart',
              title: 'No favourites yet',
              body: 'Tap the heart on any song, here or in the player, and it lands at the top of this list.',
              action: { label: 'Browse your library', icon: 'rows', onPress: () => go('/library', 'navigate') },
            }
          : {
              type: 'empty',
              key: 'e:playlist',
              icon: 'playlist',
              title: 'Nothing in here yet',
              body: ids.length
                ? "The songs you added aren't on your phone right now."
                : 'Long-press any song and choose Add to playlist.',
              action: { label: 'Find songs', icon: 'magnifying-glass', onPress: openSearch },
            },
      );
    }
    return v;
  }, [ids, lib, isFavorites, id]);

  if (!view || (!isFavorites && !playlist)) {
    return <MissingScreen title="This playlist is gone" body="It was deleted, or the link is out of date." />;
  }
  const name = isFavorites ? 'Favourites' : (playlist?.name ?? '');
  const source: PlaySource = isFavorites ? { kind: 'favorites', id: FAVORITES_ID, label: name } : { kind: 'playlist', id, label: name };
  const count = view.playIds.length;
  return (
    <DetailScreen
      kicker={isFavorites ? 'Songs you love' : 'Playlist'}
      title={name}
      subtitle={count ? `${formatCount(count, 'song')} \u00b7 ${formatTotalDuration(view.ms)}` : 'Empty for now'}
      meta={playlist ? `Updated ${formatRelative(playlist.updatedAt, now)}` : undefined}
      art={isFavorites ? FAVORITES_ART : { kind: 'mosaic', trackIds: view.playIds, seed: id, label: name }}
      playIds={view.playIds}
      source={source}
      items={view.items}
      onMore={() => openSheet({ kind: 'playlist', playlistId: id })}
      testID="playlist"
    />
  );
}
