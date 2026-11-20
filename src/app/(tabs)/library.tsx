import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useFocusEffect, useScrollToTop } from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Platform, RefreshControl, StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Button, IconButton } from '@/components/buttons';
import { EmptyState } from '@/components/empty-state';
import { LargeHeader, TopBar, useHeaderMetrics, useScrollY } from '@/components/header';
import { LibraryStatusCard } from '@/components/home/library-status';
import { Icon, type IconName } from '@/components/icon';
import { openPlayer, useBottomChrome } from '@/components/layout';
import { AlphaIndex } from '@/components/library/alpha-index';
import { SECTION_TABS_H, SectionTabs, type SectionTab } from '@/components/library/section-tabs';
import { folderHref, go, openSearch } from '@/components/nav';
import { Press } from '@/components/press';
import { AlbumTile, ArtistRow, CollectionRow, TRACK_ROW_H, TrackRow } from '@/components/rows';
import { ALBUM_SORTS, TRACK_SORTS } from '@/components/sheets/sort';
import { T } from '@/components/text';
import { useClock } from '@/hooks/use-clock';
import { listMixTracks, MADE_FOR_YOU, MIX_INFO, type ListMixId } from '@/hooks/use-mix';
import { formatCount, formatTotalDuration } from '@/lib/format';
import { primaryArtist, sectionIndex, sortAlbums, sortTracks, type AlbumSort, type TrackSort } from '@/lib/library';
import { HOUR_MS } from '@/lib/time';
import type { Album, Artist, Library, Playlist, Track } from '@/lib/types';
import { useCollections } from '@/stores/collections';
import { useHistory } from '@/stores/history';
import { rescanAndReport, useLibrary } from '@/stores/library';
import { player, usePlayer, type PlaySource } from '@/stores/player';
import { useSettings, type LibrarySection } from '@/stores/settings';
import { openSheet } from '@/stores/ui';
import { radius, space, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const SECTIONS: readonly LibrarySection[] = ['tracks', 'albums', 'artists', 'playlists', 'folders', 'genres'];
const LABELS: Record<LibrarySection, string> = {
  tracks: 'Songs',
  albums: 'Albums',
  artists: 'Artists',
  playlists: 'Playlists',
  folders: 'Folders',
  genres: 'Genres',
};
const NOUNS: Record<LibrarySection, string> = {
  tracks: 'song',
  albums: 'album',
  artists: 'artist',
  playlists: 'playlist',
  folders: 'folder',
  genres: 'genre',
};

const LIBRARY_SOURCE: PlaySource = { kind: 'library', label: 'All songs' };

// Every row type has a fixed height, so the list's length is known without measuring anything.
const TOOLBAR_H = 56;
const HEADING_H = 44;
const EMPTY_H = 320;
const ALBUM_TEXT_H = 44;
const ALBUM_GAP = space.xl;
/** Room the rows leave on the right for the A-Z strip. */
const INDEX_GUTTER = 24;
const MIN_INDEX_ROWS = 20;

// Horizontal swipes on the list flip between sections. Web keeps native touch scrolling instead.
const SWIPE = Platform.OS !== 'web';

const TRACK_INDEX_KEY: Partial<Record<TrackSort, (t: Track) => string>> = {
  title: (t) => t.title,
  artist: primaryArtist,
  album: (t) => t.album,
};
const ALBUM_INDEX_KEY: Partial<Record<AlbumSort, (a: Album) => string>> = {
  title: (a) => a.title,
  artist: (a) => a.artist,
};

type Item =
  | { type: 'track'; key: string; track: Track; index: number }
  | { type: 'albums'; key: string; albums: Album[] }
  | { type: 'artist'; key: string; artist: Artist; index: number }
  | {
      type: 'collection';
      key: string;
      title: string;
      subtitle: string;
      seed: string;
      onPress: () => void;
      onLongPress?: () => void;
      trackIds?: string[];
      icon?: IconName;
    }
  | { type: 'heading'; key: string; title: string }
  | { type: 'empty'; key: string; icon: IconName; title: string; body: string };

type AlphaRows = { letters: string[]; rows: Record<string, number> };

type Model = {
  items: Item[];
  /** Total height of the items. */
  height: number;
  index: AlphaRows | null;
};

type Grid = { cols: number; tile: number; rowH: number };

function albumGrid(width: number): Grid {
  const inner = width - space.page * 2;
  const cols = Math.max(2, Math.min(5, Math.floor((inner + space.md) / (150 + space.md))));
  const tile = Math.floor((inner - space.md * (cols - 1)) / cols);
  return { cols, tile, rowH: tile + ALBUM_TEXT_H + ALBUM_GAP };
}

/** Letters for the fast scroller, mapped to list rows; null when the list is too short to need one. */
function alphaRows<V>(list: readonly V[], keyOf: ((v: V) => string) | undefined, rowOf: (i: number) => number, rows: number): AlphaRows | null {
  if (!keyOf || rows <= MIN_INDEX_ROWS) return null;
  const { letters, offsets } = sectionIndex([...list], keyOf);
  if (letters.length < 4) return null;
  const out: Record<string, number> = {};
  for (const l of letters) out[l] = rowOf(offsets[l]);
  return { letters, rows: out };
}

function rowsModel(items: Item[], index: AlphaRows | null = null): Model {
  return { items, height: items.length * TRACK_ROW_H, index };
}

function folderPath(id: string): string {
  return id ? `/${id.replace(/\/+$/, '')}` : '';
}

type ModelInput = {
  section: LibrarySection;
  lib: Library;
  tracks: Track[];
  trackTag: string;
  trackSort: TrackSort;
  albums: Album[];
  albumSort: AlbumSort;
  grid: Grid;
  playlists: Playlist[];
  favoriteCount: number;
  mixCounts: Record<ListMixId, number> | null;
};

function buildModel(m: ModelInput): Model {
  const { lib } = m;
  switch (m.section) {
    case 'tracks':
      return rowsModel(
        m.tracks.map((t, i) => ({ type: 'track', key: `t:${m.trackTag}:${t.id}`, track: t, index: i })),
        alphaRows(m.tracks, TRACK_INDEX_KEY[m.trackSort], (i) => i, m.tracks.length),
      );
    case 'albums': {
      const { cols } = m.grid;
      const items: Item[] = [];
      for (let i = 0; i < m.albums.length; i += cols) {
        items.push({ type: 'albums', key: `a:${m.albumSort}:${cols}:${m.albums[i].id}`, albums: m.albums.slice(i, i + cols) });
      }
      return {
        items,
        height: items.length * m.grid.rowH,
        index: alphaRows(m.albums, ALBUM_INDEX_KEY[m.albumSort], (i) => Math.floor(i / cols), items.length),
      };
    }
    case 'artists':
      return rowsModel(
        lib.artists.map((a, i) => ({ type: 'artist', key: `ar:${a.id}`, artist: a, index: i })),
        alphaRows(lib.artists, (a) => a.name, (i) => i, lib.artists.length),
      );
    case 'playlists': {
      const items: Item[] = [
        {
          type: 'collection',
          key: 'c:favorites',
          title: 'Favourites',
          subtitle: m.favoriteCount ? formatCount(m.favoriteCount, 'song') : 'Tap the heart on any song',
          seed: 'favorites',
          icon: 'heart',
          onPress: () => go({ pathname: '/playlist/[id]', params: { id: 'favorites' } }),
        },
      ];
      for (const p of [...m.playlists].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const n = p.trackIds.length;
        const ms = p.trackIds.reduce((sum, id) => sum + (lib.byId.get(id)?.durationMs ?? 0), 0);
        items.push({
          type: 'collection',
          key: `c:p:${p.id}`,
          title: p.name,
          subtitle: n ? `${formatCount(n, 'song')} \u00b7 ${formatTotalDuration(ms)}` : 'No songs yet',
          seed: p.id,
          trackIds: p.trackIds,
          onPress: () => go({ pathname: '/playlist/[id]', params: { id: p.id } }),
          onLongPress: () => openSheet({ kind: 'playlist', playlistId: p.id }),
        });
      }
      if (!m.playlists.length) {
        items.push({
          type: 'collection',
          key: 'c:new',
          title: 'New playlist',
          subtitle: 'For the gym, the commute, or 2 a.m.',
          seed: 'new',
          icon: 'plus',
          onPress: () => openSheet({ kind: 'new-playlist', trackIds: [] }),
        });
      }
      items.push({ type: 'heading', key: 'h:mixes', title: 'Made for you' });
      for (const id of MADE_FOR_YOU) {
        const info = MIX_INFO[id];
        const n = m.mixCounts?.[id] ?? 0;
        items.push({
          type: 'collection',
          key: `c:m:${id}`,
          title: info.title,
          subtitle: n ? `${info.blurb} \u00b7 ${n}` : info.blurb,
          seed: `mix-${id}`,
          icon: info.icon,
          onPress: () => go({ pathname: '/mix/[id]', params: { id } }),
        });
      }
      return { items, height: (items.length - 1) * TRACK_ROW_H + HEADING_H, index: null };
    }
    case 'folders':
      return rowsModel(
        lib.folders.map((f) => {
          const n = formatCount(f.trackIds.length, 'song');
          const path = folderPath(f.id);
          return {
            type: 'collection',
            key: `c:f:${f.id}`,
            title: f.name,
            subtitle: path ? `${n} \u00b7 ${path}` : n,
            seed: `folder-${f.id}`,
            icon: 'folder',
            onPress: () => go(folderHref(f.id)),
          };
        }),
        alphaRows(lib.folders, (f) => f.name, (i) => i, lib.folders.length),
      );
    case 'genres':
      if (!lib.genres.length) {
        return {
          items: [
            {
              type: 'empty',
              key: 'e:genres',
              icon: 'tag',
              title: 'No genres here',
              body: "None of your songs carry a genre tag. Vibe search still works: Thrum listens to the music itself.",
            },
          ],
          height: EMPTY_H,
          index: null,
        };
      }
      return rowsModel(
        lib.genres.map((g) => ({
          type: 'collection',
          key: `c:g:${g.id}`,
          title: g.name,
          subtitle: formatCount(g.trackIds.length, 'song'),
          seed: `genre-${g.id}`,
          trackIds: g.trackIds,
          onPress: () => go({ pathname: '/genre/[id]', params: { id: g.id } }),
        })),
        alphaRows(lib.genres, (g) => g.name, (i) => i, lib.genres.length),
      );
  }
}

function Toolbar({ section, count, onShuffle }: { section: LibrarySection; count: number; onShuffle: () => void }) {
  const c = useTheme();
  const trackSort = useSettings((s) => s.trackSort);
  const reversed = useSettings((s) => s.trackSortDesc);
  const albumSort = useSettings((s) => s.albumSort);
  const set = useSettings((s) => s.set);
  const sortLabel =
    section === 'tracks'
      ? TRACK_SORTS.find((o) => o.id === trackSort)?.label
      : section === 'albums'
        ? ALBUM_SORTS.find((o) => o.id === albumSort)?.label
        : undefined;

  return (
    <View style={styles.toolbar}>
      {section === 'tracks' ? (
        <Button label="Shuffle all" icon="shuffle" size="sm" onPress={onShuffle} disabled={count === 0} testID="lib-shuffle" />
      ) : (
        <T variant="label" color="ink4" numberOfLines={1}>
          {formatCount(count, NOUNS[section])}
        </T>
      )}
      <View style={styles.flex} />
      {sortLabel ? (
        <Press
          onPress={() => openSheet({ kind: 'sort' })}
          haptic="tap"
          scale={0.96}
          hitSlop={6}
          accessibilityLabel={`Sorted by ${sortLabel}. Change sort`}
          style={[styles.sort, { backgroundColor: c.fill }]}
          testID="lib-sort">
          <T variant="calloutMedium" color="ink2" numberOfLines={1} style={styles.shrink}>
            {sortLabel}
          </T>
          <Icon name="caret-down" size={14} color={c.ink3} weight="bold" />
        </Press>
      ) : null}
      {section === 'tracks' ? (
        <IconButton
          icon="arrows-down-up"
          label={reversed ? 'Reversed order. Restore normal order' : 'Reverse order'}
          selected={reversed}
          tone={reversed ? 'fill' : 'plain'}
          color={reversed ? c.accent : c.ink2}
          size={40}
          haptic="select"
          onPress={() => set('trackSortDesc', !reversed)}
          testID="lib-reverse"
        />
      ) : null}
      {section === 'playlists' && count > 0 ? (
        <Button
          label="New"
          icon="plus"
          size="sm"
          variant="secondary"
          onPress={() => openSheet({ kind: 'new-playlist', trackIds: [] })}
          testID="lib-new-playlist"
        />
      ) : null}
    </View>
  );
}

export default function LibraryScreen() {
  const c = useTheme();
  const { ref, y } = useScrollY();
  useScrollToTop(ref);
  const metrics = useHeaderMetrics();
  const { bar, large, collapseAt } = metrics;
  const bottom = useBottomChrome(true);
  const { width, height } = useWindowDimensions();
  const [viewH, setViewH] = useState(height);

  const lib = useLibrary((s) => s.lib);
  const scanning = useLibrary((s) => s.scanning);
  const section = useSettings((s) => s.section);
  const trackSort = useSettings((s) => s.trackSort);
  const reversed = useSettings((s) => s.trackSortDesc);
  const albumSort = useSettings((s) => s.albumSort);
  const setSetting = useSettings((s) => s.set);
  const playlists = useCollections((s) => s.playlists);
  const favoriteCount = useCollections((s) => s.favoriteOrder.length);
  const onPlaylists = section === 'playlists';
  // Most played sorts by a snapshot taken when you arrive, so the list doesn't reshuffle under your thumb as songs finish.
  const [playStats, setPlayStats] = useState(() => useHistory.getState().stats);
  useFocusEffect(
    useCallback(() => {
      if (trackSort === 'plays') setPlayStats(useHistory.getState().stats);
    }, [trackSort]),
  );
  const sortStats = trackSort === 'plays' ? playStats : undefined;
  // Mix counts only show on Playlists, so only that section follows play history live.
  const mixStats = useHistory((s) => (onPlaylists ? s.stats : null));
  const mixPlays = useHistory((s) => (onPlaylists ? s.plays : null));
  const now = useClock(HOUR_MS);
  const hasMusic = lib.tracks.length > 0;

  // "Reverse" flips whichever direction is natural for the sort (newest and most played come first).
  const natural = trackSort === 'added' || trackSort === 'plays';
  const tracks = useMemo(
    () => sortTracks(lib.tracks, trackSort, sortStats, natural !== reversed),
    [lib.tracks, trackSort, sortStats, natural, reversed],
  );
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks]);
  const albums = useMemo(() => sortAlbums(lib.albums, albumSort), [lib.albums, albumSort]);
  const grid = useMemo(() => albumGrid(width), [width]);
  const mixCounts = useMemo(() => {
    if (!mixStats || !mixPlays) return null;
    const out = {} as Record<ListMixId, number>;
    for (const id of MADE_FOR_YOU) out[id] = listMixTracks(id, lib, mixStats, mixPlays, now + HOUR_MS - 1).length;
    return out;
  }, [lib, mixStats, mixPlays, now]);
  const trackTag = `${trackSort}${reversed ? '-r' : ''}`;
  const model = useMemo(
    () =>
      buildModel({ section, lib, tracks, trackTag, trackSort, albums, albumSort, grid, playlists, favoriteCount, mixCounts }),
    [section, lib, tracks, trackTag, trackSort, albums, albumSort, grid, playlists, favoriteCount, mixCounts],
  );
  const gutter = model.index ? INDEX_GUTTER : undefined;

  const list = () => ref.current as FlashListRef<Item> | null;

  // Section switches keep the tabs pinned (when they were) and slide the new list in from the side it came from.
  const enter = useSharedValue(0);
  const pending = useRef<{ dir: number; offset: number | null } | null>(null);
  const showSection = (next: LibrarySection) => {
    const current = useSettings.getState().section;
    if (next === current) return;
    pending.current = {
      dir: SECTIONS.indexOf(next) > SECTIONS.indexOf(current) ? 1 : -1,
      offset: y.get() > collapseAt ? collapseAt : null,
    };
    setSetting('section', next);
  };
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (p.offset !== null) (ref.current as FlashListRef<Item> | null)?.scrollToOffset({ offset: p.offset, animated: false });
    enter.set(p.dir * 18);
    enter.set(withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }));
  }, [section, enter, ref]);

  // A new sort starts from the top of the list.
  const sortTag = `${trackTag}:${albumSort}`;
  const lastSort = useRef(sortTag);
  useLayoutEffect(() => {
    if (lastSort.current === sortTag) return;
    lastSort.current = sortTag;
    if (y.get() > collapseAt) (ref.current as FlashListRef<Item> | null)?.scrollToOffset({ offset: collapseAt, animated: false });
  }, [sortTag, y, collapseAt, ref]);

  const step = (dir: 1 | -1) => {
    const next = SECTIONS[SECTIONS.indexOf(useSettings.getState().section) + dir];
    if (!next) return;
    haptic('select');
    showSection(next);
  };
  const swipe = usePanGesture({
    enabled: SWIPE && hasMusic,
    activeOffsetX: [-24, 24],
    failOffsetY: [-14, 14],
    onDeactivate: (e) => {
      'worklet';
      if (e.canceled) return;
      const dx = e.translationX;
      const fling = Math.abs(e.velocityX) > 650 && Math.sign(e.velocityX) === Math.sign(dx);
      if (Math.abs(dx) > 72 || fling) scheduleOnRN(step, dx < 0 ? 1 : -1);
    },
  });

  const onReselect = () => {
    list()?.scrollToOffset({ offset: y.get() > collapseAt + 1 ? collapseAt : 0, animated: true });
  };

  const onPick = (letter: string) => {
    const row = model.index?.rows[letter];
    const l = list();
    const layout = row === undefined ? undefined : l?.getLayout(row);
    if (!l || !layout) return;
    l.scrollToOffset({ offset: Math.max(collapseAt, layout.y + l.getFirstItemOffset() - bar - SECTION_TABS_H), animated: false });
  };

  const onPlay = (i: number) => {
    const s = usePlayer.getState();
    if (s.source?.kind === 'library' && s.trackId === trackIds[i]) {
      openPlayer();
      return;
    }
    player.playIds(trackIds, i, { source: LIBRARY_SOURCE });
  };

  const [pulling, setPulling] = useState(false);
  const onRefresh = () => {
    setPulling(true);
    void rescanAndReport().finally(() => setPulling(false));
  };

  const headerStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -y.get() }] }));
  const tabsStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(bar, large - y.get()) }] }));
  const hairStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [collapseAt - 12, collapseAt], [0, 1], 'clamp'),
  }));
  const enterStyle = useAnimatedStyle(() => {
    const v = enter.get();
    return { opacity: 1 - Math.min(0.5, Math.abs(v) / 40), transform: [{ translateX: v }] };
  });
  const indexStyle = useAnimatedStyle(() => {
    const p = interpolate(y.get(), [collapseAt * 0.6, collapseAt], [0, 1], 'clamp');
    return { opacity: p, transform: [{ translateX: (1 - p) * 40 }] };
  });
  // The strip only takes touches once the header has folded away and it's fully on screen.
  const [indexLive, setIndexLive] = useState(false);
  useAnimatedReaction(
    () => y.get() >= collapseAt - 1,
    (live, prev) => {
      if (live !== prev) scheduleOnRN(setIndexLive, live);
    },
    [collapseAt],
  );

  const kicker = scanning
    ? 'Looking for new music\u2026'
    : `${formatCount(lib.tracks.length, 'song')} \u00b7 ${formatTotalDuration(lib.totalDurationMs)}`;
  const topBar = (
    <TopBar
      y={y}
      title="Library"
      collapseAt={collapseAt}
      flat={hasMusic}
      right={
        <>
          <IconButton icon="magnifying-glass" label="Search" onPress={openSearch} testID="lib-open-search" />
          <IconButton icon="gear-six" label="Settings" onPress={() => go('/settings')} testID="lib-open-settings" />
        </>
      }
    />
  );

  if (!hasMusic) {
    return (
      <View style={[styles.root, { backgroundColor: c.bg }]} testID="library">
        <Animated.ScrollView ref={ref} showsVerticalScrollIndicator={false}>
          <LargeHeader y={y} metrics={metrics} title="Library" kicker="Your music" testID="library-header" />
          <LibraryStatusCard />
          <View style={{ height: bottom }} />
        </Animated.ScrollView>
        {topBar}
      </View>
    );
  }

  const counts: Record<LibrarySection, number> = {
    tracks: lib.tracks.length,
    albums: lib.albums.length,
    artists: lib.artists.length,
    playlists: playlists.length,
    folders: lib.folders.length,
    genres: lib.genres.length,
  };
  const tabs: SectionTab<LibrarySection>[] = SECTIONS.map((id) => ({
    id,
    label: LABELS[id],
    count: counts[id] > 0 ? counts[id] : undefined,
  }));
  const headerH = large + SECTION_TABS_H + TOOLBAR_H;
  // Short sections still scroll far enough to keep the tabs pinned, so switching never jolts the header.
  const footerH = Math.max(bottom + space.lg, viewH + collapseAt - headerH - model.height);

  const renderItem = ({ item }: { item: Item }) => {
    switch (item.type) {
      case 'track':
        return <TrackRow track={item.track} index={item.index} onPlay={onPlay} gutter={gutter} testID={`lib-track-${item.index}`} />;
      case 'albums':
        return (
          <View style={[styles.albumRow, { height: grid.rowH }]}>
            {item.albums.map((a) => (
              <AlbumTile key={a.id} album={a} size={grid.tile} testID={`lib-album-${a.id}`} />
            ))}
          </View>
        );
      case 'artist':
        return <ArtistRow artist={item.artist} gutter={gutter} testID={`lib-artist-${item.index}`} />;
      case 'collection':
        return (
          <CollectionRow
            title={item.title}
            subtitle={item.subtitle}
            seed={item.seed}
            trackIds={item.trackIds}
            icon={item.icon}
            onPress={item.onPress}
            onLongPress={item.onLongPress}
            gutter={gutter}
            testID={`lib-${item.key}`}
          />
        );
      case 'heading':
        return (
          <View style={styles.heading}>
            <T variant="label" color="ink4" accessibilityRole="header">
              {item.title}
            </T>
          </View>
        );
      case 'empty':
        return (
          <View style={styles.empty}>
            <EmptyState compact icon={item.icon} title={item.title} body={item.body} />
          </View>
        );
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]} onLayout={(e) => setViewH(e.nativeEvent.layout.height)} testID="library">
      <GestureDetector gesture={swipe}>
        <Animated.View style={[styles.flex, enterStyle]}>
          <FlashList
            ref={ref}
            data={model.items}
            keyExtractor={(item) => item.key}
            getItemType={(item) => item.type}
            renderItem={renderItem}
            drawDistance={800}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View>
                <View style={{ height: large + SECTION_TABS_H }} />
                <Toolbar section={section} count={counts[section]} onShuffle={() => player.playIds(trackIds, -1, { shuffle: true, source: LIBRARY_SOURCE })} />
              </View>
            }
            ListFooterComponent={<View style={{ height: footerH }} />}
            refreshControl={
              <RefreshControl
                refreshing={pulling}
                onRefresh={onRefresh}
                progressViewOffset={bar}
                colors={[c.onAccent]}
                progressBackgroundColor={c.accent}
                tintColor={c.accent}
              />
            }
            testID="library-list"
          />
        </Animated.View>
      </GestureDetector>
      <Animated.View pointerEvents="none" style={[styles.layer, headerStyle]}>
        <LargeHeader y={y} metrics={metrics} title="Library" kicker={kicker} testID="library-header" />
      </Animated.View>
      <Animated.View style={[styles.tabs, { backgroundColor: c.bg }, tabsStyle]}>
        <SectionTabs tabs={tabs} value={section} onChange={showSection} onReselect={onReselect} testID="lib-tab" />
        <Animated.View pointerEvents="none" style={[styles.hairline, { backgroundColor: c.line }, hairStyle]} />
      </Animated.View>
      {model.index ? (
        <Animated.View pointerEvents={indexLive ? 'box-none' : 'none'} style={[StyleSheet.absoluteFill, indexStyle]}>
          <AlphaIndex letters={model.index.letters} onPick={onPick} top={bar + SECTION_TABS_H + space.sm} bottom={bottom + space.sm} live={indexLive} />
        </Animated.View>
      ) : null}
      {topBar}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  layer: { position: 'absolute', top: 0, left: 0, right: 0 },
  tabs: { position: 'absolute', top: 0, left: 0, right: 0, height: SECTION_TABS_H },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  toolbar: {
    height: TOOLBAR_H,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.page,
    paddingRight: space.page - 4,
  },
  sort: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    flexShrink: 1,
  },
  albumRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.page },
  heading: { height: HEADING_H, justifyContent: 'flex-end', paddingHorizontal: space.page, paddingBottom: space.sm },
  empty: { height: EMPTY_H, justifyContent: 'center' },
});
