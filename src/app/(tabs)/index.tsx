import { useScrollToTop } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button, IconButton } from '@/components/buttons';
import { Card } from '@/components/card';
import { LargeHeader, SectionHeader, TopBar, useHeaderMetrics, useScrollY } from '@/components/header';
import { DaylistCard } from '@/components/home/daylist-card';
import { LibraryStatusCard } from '@/components/home/library-status';
import { Icon } from '@/components/icon';
import { useBottomChrome } from '@/components/layout';
import { MoodTile } from '@/components/mood-tile';
import { go } from '@/components/nav';
import { Press } from '@/components/press';
import { AlbumTile } from '@/components/rows';
import { MixCard, Shelf, TrackCard } from '@/components/shelf';
import { T } from '@/components/text';
import { useVibeContext } from '@/hooks/use-library';
import { MADE_FOR_YOU, resolveMix, type Mix } from '@/hooks/use-mix';
import { buildDaylist, moodMixes } from '@/lib/daylist';
import { similarTracks } from '@/lib/features';
import { formatCount, formatTotalDuration, greeting } from '@/lib/format';
import { sortAlbums } from '@/lib/library';
import { computeStats, recentlyPlayed } from '@/lib/stats';
import { daypart, HOUR_MS, MINUTE_MS, WEEKDAY_NAMES } from '@/lib/time';
import type { Track } from '@/lib/types';
import { useCollections } from '@/stores/collections';
import { useHistory } from '@/stores/history';
import { player, type PlaySource } from '@/stores/player';
import { useSettings } from '@/stores/settings';
import { radius, space, useTheme } from '@/theme';

const CARD = 136;
const MIX = 150;

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function TrackShelf({ tracks, source, testID }: { tracks: Track[]; source: PlaySource; testID: string }) {
  const ids = tracks.map((t) => t.id);
  return (
    <Shelf testID={testID}>
      {tracks.map((t, i) => (
        <TrackCard
          key={t.id}
          track={t}
          size={CARD}
          onPress={() => player.playIds(ids, i, { source })}
          testID={`${testID}-${i}`}
        />
      ))}
    </Shelf>
  );
}

export default function Home() {
  const c = useTheme();
  const { ref, y } = useScrollY();
  useScrollToTop(ref);
  const metrics = useHeaderMetrics();
  const bottom = useBottomChrome(true);
  const { width } = useWindowDimensions();
  const ctx = useVibeContext();
  const plays = useHistory((s) => s.plays);
  const name = useSettings((s) => s.name);
  const favorites = useCollections((s) => s.favoriteOrder);
  const playlists = useCollections((s) => s.playlists);
  const { lib } = ctx;
  const hasMusic = lib.tracks.length > 0;

  const date = new Date(ctx.now);
  const hello = greeting(date, name);
  const kicker = `${capitalize(WEEKDAY_NAMES[date.getDay()])} \u00b7 ${daypart(date).label}`;

  const daylist = useMemo(() => buildDaylist(ctx, plays, new Date(ctx.now)), [ctx, plays]);
  const moods = useMemo(() => moodMixes(ctx), [ctx]);
  const mixes = useMemo(
    () => MADE_FOR_YOU.map((id) => resolveMix(id, ctx, plays)).filter((m): m is Mix => m !== null && m.trackIds.length > 0),
    [ctx, plays],
  );
  const recent = useMemo(
    () =>
      recentlyPlayed(plays, 12)
        .map((id) => lib.byId.get(id))
        .filter((t): t is Track => !!t),
    [plays, lib],
  );
  const seed = recent[0];
  const alike = useMemo(
    () =>
      seed
        ? similarTracks(seed.id, ctx, 12)
            .map((r) => lib.byId.get(r.id))
            .filter((t): t is Track => !!t)
        : [],
    [seed, ctx, lib],
  );
  const bass = moods.find((m) => m.mood.id === 'bass');
  const bassTracks = (bass?.trackIds ?? [])
    .slice(0, 12)
    .map((id) => lib.byId.get(id))
    .filter((t): t is Track => !!t);
  const freshAlbums = useMemo(() => sortAlbums(lib.albums, 'added').slice(0, 12), [lib]);
  // ctx.now is floored to the hour; count to the end of it so this hour's plays are in.
  const week = useMemo(() => computeStats(plays, lib, 'week', ctx.now + HOUR_MS - 1), [plays, lib, ctx.now]);

  const tileW = Math.round(Math.min(176, (width - space.page * 2 - space.md) / 2.25));
  const columns: (typeof moods)[] = [];
  for (let i = 0; i < moods.length; i += 2) columns.push(moods.slice(i, i + 2));

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView ref={ref} showsVerticalScrollIndicator={false} testID="home">
        <LargeHeader y={y} metrics={metrics} kicker={kicker} title={hello.title} subtitle={hello.subtitle} testID="home-header" />
        <LibraryStatusCard />
        {hasMusic ? (
          <>
            <View style={styles.quick}>
              <Button
                label="Shuffle all"
                icon="shuffle"
                grow
                onPress={() => player.playIds(lib.tracks.map((t) => t.id), -1, { shuffle: true, source: { kind: 'library', label: 'All songs' } })}
                testID="home-shuffle"
              />
              <Button
                label={favorites.length ? `Favourites \u00b7 ${favorites.length}` : 'Favourites'}
                icon="heart"
                variant="secondary"
                grow
                onPress={() => go({ pathname: '/playlist/[id]', params: { id: 'favorites' } })}
                testID="home-favorites"
              />
            </View>

            <DaylistCard daylist={daylist} lib={lib} />

            {recent.length ? (
              <>
                <SectionHeader
                  kicker="Jump back in"
                  title="Recently played"
                  action={{ label: 'See all', onPress: () => go({ pathname: '/mix/[id]', params: { id: 'recently-played' } }) }}
                />
                <TrackShelf tracks={recent} source={{ kind: 'mix', id: 'recently-played', label: 'Recently played' }} testID="home-recent" />
              </>
            ) : null}

            {bass && bassTracks.length >= 4 ? (
              <>
                <SectionHeader
                  kicker="Feel it in your chest"
                  title="Bass bangers"
                  action={{ label: 'Play all', onPress: () => go({ pathname: '/mix/[id]', params: { id: 'mood-bass' } }) }}
                />
                <TrackShelf tracks={bassTracks} source={{ kind: 'mood', id: 'bass', label: 'Bass bangers' }} testID="home-bass" />
              </>
            ) : null}

            {mixes.length || playlists.length ? (
              <>
                <SectionHeader kicker="Made for you" title="Your mixes" />
                <Shelf testID="home-mixes">
                  {mixes.map((m) => (
                    <MixCard
                      key={m.id}
                      title={m.title}
                      subtitle={formatCount(m.trackIds.length, 'song')}
                      trackIds={m.trackIds}
                      seed={`mix-${m.id}`}
                      size={MIX}
                      onPress={() => go({ pathname: '/mix/[id]', params: { id: m.id } })}
                      testID={`home-mix-${m.id}`}
                    />
                  ))}
                  {playlists.slice(0, 8).map((p) => (
                    <MixCard
                      key={p.id}
                      title={p.name}
                      subtitle={`Playlist \u00b7 ${formatCount(p.trackIds.length, 'song')}`}
                      trackIds={p.trackIds}
                      seed={p.id}
                      size={MIX}
                      onPress={() => go({ pathname: '/playlist/[id]', params: { id: p.id } })}
                      testID={`home-playlist-${p.id}`}
                    />
                  ))}
                </Shelf>
              </>
            ) : null}

            {columns.length ? (
              <>
                <SectionHeader kicker="Moods" title="Whatever you're feeling" />
                <Shelf testID="home-moods">
                  {columns.map((col) => (
                    <View key={col[0].mood.id} style={styles.moodColumn}>
                      {col.map((m) => (
                        <MoodTile
                          key={m.mood.id}
                          mood={m.mood}
                          width={tileW}
                          height={88}
                          subtitle={formatCount(m.trackIds.length, 'song')}
                          onPress={() => go({ pathname: '/mix/[id]', params: { id: `mood-${m.mood.id}` } })}
                          onLongPress={() => player.playIds(m.trackIds, 0, { source: { kind: 'mood', id: m.mood.id, label: `${m.mood.label} mix` } })}
                          testID={`home-mood-${m.mood.id}`}
                        />
                      ))}
                    </View>
                  ))}
                </Shelf>
              </>
            ) : null}

            {seed && alike.length >= 4 ? (
              <>
                <SectionHeader
                  kicker="Because you played"
                  title={seed.title}
                  action={{ label: 'Play mix', onPress: () => go({ pathname: '/mix/[id]', params: { id: `similar-${seed.id}` } }) }}
                />
                <TrackShelf tracks={alike} source={{ kind: 'similar', id: seed.id, label: `Like ${seed.title}` }} testID="home-alike" />
              </>
            ) : null}

            {freshAlbums.length ? (
              <>
                <SectionHeader
                  kicker="New on your phone"
                  title="Fresh albums"
                  action={{ label: 'Library', onPress: () => go('/library', 'navigate') }}
                />
                <Shelf testID="home-albums">
                  {freshAlbums.map((a) => (
                    <AlbumTile key={a.id} album={a} size={CARD} testID={`home-album-${a.id}`} />
                  ))}
                </Shelf>
              </>
            ) : null}

            {week.plays > 0 ? (
              <Press
                onPress={() => go('/stats')}
                scale={0.985}
                accessibilityRole="button"
                accessibilityLabel="Open your listening stats"
                style={styles.statsWrap}
                testID="home-stats">
                <Card style={styles.statsCard}>
                  <View style={styles.statsTop}>
                    <T variant="label" color="ink3">
                      Your week in music
                    </T>
                    <Icon name="arrow-up-right" size={18} color={c.ink3} />
                  </View>
                  <T variant="display">{formatTotalDuration(week.minutes * MINUTE_MS)}</T>
                  <T variant="callout" color="ink3" numberOfLines={2}>
                    {[week.persona, week.topArtists[0] ? `mostly ${week.topArtists[0].label}` : null, formatCount(week.uniqueTracks, 'song')]
                      .filter(Boolean)
                      .join(' \u00b7 ')}
                  </T>
                </Card>
              </Press>
            ) : null}
          </>
        ) : null}
        <View style={{ height: bottom + space.xxl }} />
      </Animated.ScrollView>
      <TopBar
        y={y}
        title="For you"
        collapseAt={metrics.collapseAt}
        right={
          <>
            <IconButton icon="chart-bar" label="Listening stats" onPress={() => go('/stats')} testID="home-open-stats" />
            <IconButton icon="gear-six" label="Settings" onPress={() => go('/settings')} testID="home-open-settings" />
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  quick: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.page, marginBottom: space.lg },
  moodColumn: { gap: space.md },
  statsWrap: { marginTop: space.xxl },
  statsCard: { borderRadius: radius.lg },
  statsTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
