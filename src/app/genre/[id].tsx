import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { DetailScreen, MissingScreen, trackItems } from '@/components/collection';
import { formatCount, formatTotalDuration } from '@/lib/format';
import { genreTracks, primaryArtist, sortTracks } from '@/lib/library';
import type { Track } from '@/lib/types';
import { useLibrary } from '@/stores/library';

/** "Arijit Singh, Pritam, Shreya Ghoshal and 9 more": who the genre mostly is, in your library. */
function leadingArtists(tracks: Track[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const a = primaryArtist(t);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  const names = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([n]) => n);
  if (!names.length) return undefined;
  const shown = names.slice(0, 3).join(', ');
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
}

export default function GenreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const lib = useLibrary((s) => s.lib);
  const genre = lib.genres.find((g) => g.id === id);

  const view = useMemo(() => {
    if (!genre) return null;
    const tracks = sortTracks(genreTracks(lib, genre.id), 'artist');
    const ms = tracks.reduce((sum, t) => sum + t.durationMs, 0);
    return { tracks, ms, playIds: tracks.map((t) => t.id), items: trackItems(tracks), artists: leadingArtists(tracks) };
  }, [genre, lib]);

  if (!genre || !view) {
    return <MissingScreen title="Nothing tagged with this genre" body="The songs may have been retagged, moved or deleted." />;
  }
  return (
    <DetailScreen
      kicker="Genre"
      title={genre.name}
      subtitle={`${formatCount(view.tracks.length, 'song')} \u00b7 ${formatTotalDuration(view.ms)}`}
      meta={view.artists}
      art={{ kind: 'mosaic', trackIds: view.playIds, seed: `genre-${genre.id}`, label: genre.name }}
      playIds={view.playIds}
      source={{ kind: 'genre', id: genre.id, label: genre.name }}
      items={view.items}
      testID="genre"
    />
  );
}
