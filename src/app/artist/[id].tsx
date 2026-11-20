import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { DetailScreen, MissingScreen, type DetailItem } from '@/components/collection';
import { formatCount, formatTotalDuration } from '@/lib/format';
import { artistAlbums, artistTracks, sortTracks } from '@/lib/library';
import type { Album, Artist, Track, TrackStat } from '@/lib/types';
import { useHistory } from '@/stores/history';
import { useLibrary } from '@/stores/library';

const TOP = 5;

function artistItems(artist: Artist, tracks: Track[], albums: Album[], stats: Map<string, TrackStat>): DetailItem[] {
  const items: DetailItem[] = [];
  const order = new Map(tracks.map((t, i) => [t.id, i]));
  const plays = (t: Track) => stats.get(t.id)?.plays ?? 0;
  const top = tracks
    .filter((t) => plays(t) > 0)
    .sort((a, b) => plays(b) - plays(a))
    .slice(0, TOP);
  // Co-credits are worth showing; the artist's own name on every row isn't.
  const credit = (t: Track) => (t.artists.length > 1 ? `${t.artist} \u00b7 ${t.album}` : t.album);

  if (top.length && tracks.length > TOP) {
    items.push({ type: 'heading', key: 'h:top', title: 'Your most played' });
    for (const t of top) {
      items.push({
        type: 'track',
        key: `top:${t.id}`,
        track: t,
        index: order.get(t.id) ?? 0,
        subtitle: `${formatCount(plays(t), 'play')} \u00b7 ${t.album}`,
      });
    }
  }
  if (albums.length) {
    items.push({ type: 'heading', key: 'h:albums', title: 'Albums', kicker: formatCount(albums.length, 'album') });
    items.push({ type: 'albums', key: 'a:albums', albums });
  }
  if (items.length) {
    items.push({ type: 'heading', key: 'h:songs', title: 'Songs', kicker: formatCount(tracks.length, 'song') });
  }
  tracks.forEach((t, i) => items.push({ type: 'track', key: `t:${t.id}`, track: t, index: i, subtitle: credit(t) }));
  if (!tracks.length) {
    items.push({ type: 'empty', key: 'e:songs', icon: 'microphone-stage', title: `No songs by ${artist.name} right now` });
  }
  return items;
}

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lib = useLibrary((s) => s.lib);
  const stats = useHistory((s) => s.stats);
  const artist = lib.artistById.get(id);

  const view = useMemo(() => {
    if (!artist) return null;
    // Album by album, so playing the page runs through records the way they were made.
    const tracks = sortTracks(artistTracks(lib, artist.id), 'album');
    const albums = artistAlbums(lib, artist.id);
    let ms = 0;
    let plays = 0;
    for (const t of tracks) {
      ms += t.durationMs;
      plays += stats.get(t.id)?.plays ?? 0;
    }
    return { tracks, albums, ms, plays, playIds: tracks.map((t) => t.id), items: artistItems(artist, tracks, albums, stats) };
  }, [artist, lib, stats]);

  if (!artist || !view) {
    return <MissingScreen title="This artist isn't here anymore" body="Their songs may have been moved or deleted from your phone." />;
  }
  const cover = view.albums[0];
  const first = view.tracks[0];
  return (
    <DetailScreen
      kicker="Artist"
      title={artist.name}
      subtitle={[formatCount(view.tracks.length, 'song'), view.albums.length ? formatCount(view.albums.length, 'album') : null]
        .filter(Boolean)
        .join(' \u00b7 ')}
      meta={[formatTotalDuration(view.ms), view.plays ? `${formatCount(view.plays, 'play')} so far` : null].filter(Boolean).join(' \u00b7 ')}
      art={{
        kind: 'cover',
        albumId: cover?.id ?? first?.albumId ?? artist.id,
        trackId: cover?.coverTrackId ?? first?.id ?? '',
        label: artist.name,
        seed: artist.id,
        round: true,
      }}
      playIds={view.playIds}
      source={{ kind: 'artist', id: artist.id, label: artist.name }}
      items={view.items}
      testID="artist"
    />
  );
}
