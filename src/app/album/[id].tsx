import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { DetailScreen, MissingScreen, type DetailItem } from '@/components/collection';
import { go } from '@/components/nav';
import { useClock } from '@/hooks/use-clock';
import { formatCount, formatShortDate, formatTotalDuration } from '@/lib/format';
import { albumTracks, artistAlbums, artistIdOf, VARIOUS_ARTISTS } from '@/lib/library';
import { splitArtists } from '@/lib/text';
import { HOUR_MS } from '@/lib/time';
import type { Album, Library, Track } from '@/lib/types';
import { useLibrary } from '@/stores/library';
import { openSheet } from '@/stores/ui';

const MORE_BY = 12;

/** The album artist's own page, when there is one to go to. */
function albumArtist(lib: Library, album: Album): { id: string; name: string } | null {
  if (album.artist === VARIOUS_ARTISTS) return null;
  const name = splitArtists(album.artist)[0] ?? album.artist;
  const id = artistIdOf(name);
  return lib.artistById.has(id) ? { id, name } : null;
}

function albumItems(
  album: Album,
  tracks: Track[],
  artist: { id: string; name: string } | null,
  more: Album[],
  now: number,
): DetailItem[] {
  const items: DetailItem[] = [];
  const discs = new Set(tracks.map((t) => t.discNo ?? 1));
  // Untagged rips get running numbers rather than a column of dots.
  const tagged = tracks.some((t) => t.trackNo !== null);
  let disc: number | null = null;
  tracks.forEach((t, i) => {
    const d = t.discNo ?? 1;
    if (discs.size > 1 && d !== disc) {
      disc = d;
      items.push({ type: 'heading', key: `h:disc-${d}`, title: `Disc ${d}` });
    }
    items.push({ type: 'track', key: `t:${t.id}`, track: t, index: i, number: tagged ? t.trackNo : i + 1 });
  });
  if (album.dateAdded > 0) {
    items.push({ type: 'note', key: 'n:added', text: `Added to your phone ${formatShortDate(album.dateAdded, now)}` });
  }
  if (artist && more.length) {
    items.push({
      type: 'heading',
      key: 'h:more',
      title: `More by ${artist.name}`,
      action: { label: 'See all', onPress: () => go({ pathname: '/artist/[id]', params: { id: artist.id } }) },
    });
    items.push({ type: 'albums', key: 'a:more', albums: more });
  }
  return items;
}

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lib = useLibrary((s) => s.lib);
  const now = useClock(HOUR_MS);
  const album = lib.albumById.get(id);

  const view = useMemo(() => {
    if (!album) return null;
    const tracks = albumTracks(lib, album.id);
    const artist = albumArtist(lib, album);
    const more = artist ? artistAlbums(lib, artist.id).filter((a) => a.id !== album.id).slice(0, MORE_BY) : [];
    return { tracks, artist, playIds: tracks.map((t) => t.id), items: albumItems(album, tracks, artist, more, now) };
  }, [album, lib, now]);

  if (!album || !view) {
    return <MissingScreen title="This album isn't here anymore" body="It may have been moved or deleted from your phone." />;
  }
  const { artist } = view;
  return (
    <DetailScreen
      kicker="Album"
      title={album.title}
      subtitle={album.artist}
      onSubtitlePress={artist ? () => go({ pathname: '/artist/[id]', params: { id: artist.id } }) : undefined}
      meta={[album.year, formatCount(view.tracks.length, 'song'), formatTotalDuration(album.durationMs)].filter(Boolean).join(' \u00b7 ')}
      art={{ kind: 'cover', albumId: album.id, trackId: album.coverTrackId, label: album.title }}
      playIds={view.playIds}
      source={{ kind: 'album', id: album.id, label: album.title }}
      items={view.items}
      onMore={() => openSheet({ kind: 'album', albumId: album.id })}
      testID="album"
    />
  );
}
