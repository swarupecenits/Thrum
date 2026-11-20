import { useFocusEffect, useNavigation } from 'expo-router';
import type { BottomTabNavigationProp } from 'expo-router/js-tabs';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
} from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { Chip } from '@/components/buttons';
import { EmptyState } from '@/components/empty-state';
import { LargeHeader, SectionHeader, TopBar, useHeaderMetrics, useScrollY, type HeaderMetrics } from '@/components/header';
import { LibraryStatusCard } from '@/components/home/library-status';
import type { IconName } from '@/components/icon';
import { openPlayer, useBottomChrome } from '@/components/layout';
import { MOOD_ICONS } from '@/components/mood-tile';
import { go, vibeHref } from '@/components/nav';
import { AlbumTile, ArtistRow, CollectionRow, TrackRow } from '@/components/rows';
import { Shelf } from '@/components/shelf';
import { T } from '@/components/text';
import { VibeIdle } from '@/components/vibe/idle';
import { SEARCH_BAR_H, SearchField } from '@/components/vibe/search-field';
import { isExactName, resolveTop, TopResult } from '@/components/vibe/top-result';
import { VibeCard } from '@/components/vibe/vibe-card';
import { useVibeContext } from '@/hooks/use-library';
import { similarTracks } from '@/lib/features';
import { formatCount, formatNumber } from '@/lib/format';
import { MOODS } from '@/lib/moods';
import { search } from '@/lib/search';
import type { VibeChip } from '@/lib/types';
import { describeVibe, parseVibe, rankByVibe, withoutChip } from '@/lib/vibe';
import { useFeatures } from '@/stores/features';
import { player, usePlayer, type PlaySource } from '@/stores/player';
import { rememberSearch, useSearchIndex } from '@/stores/searches';
import { useUi } from '@/stores/ui';
import { space, useTheme } from '@/theme';

const FITS = 6;
const SONGS = 6;
const ARTISTS = 4;
const ALBUMS = 12;
const COLLECTIONS = 4;
const ALIKE = 5;
const ALBUM = 140;

/** The last "open search" request acted on. Module-level, so a tab that mounts late still answers it. */
let handledFocus = 0;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s;
}

function scrollTo(ref: { current: unknown }, y: number, animated: boolean) {
  (ref.current as ScrollViewInstance | null)?.scrollTo({ y, animated });
}

const CHIP_ICONS: Record<VibeChip['kind'], IconName> = {
  mood: 'circle-half',
  tempo: 'heartbeat',
  energy: 'lightning',
  era: 'calendar-blank',
  genre: 'tag',
  personal: 'user-circle',
  duration: 'hourglass',
  bass: 'speaker-hifi',
  similar: 'magic-wand',
  text: 'text-aa',
};

function chipLook(chip: VibeChip): { label: string; icon: IconName; color?: string } {
  if (chip.kind === 'text') return { label: `\u201c${clip(chip.label, 28)}\u201d`, icon: CHIP_ICONS.text };
  const mood = chip.kind === 'mood' ? MOODS.find((m) => m.label === chip.label) : undefined;
  return mood
    ? { label: chip.label, icon: MOOD_ICONS[mood.id], color: mood.color }
    : { label: clip(chip.label, 28), icon: CHIP_ICONS[chip.kind] };
}

/** What the parser understood, one removable chip per idea: tapping one un-says it. */
function Heard({ chips, onRemove }: { chips: VibeChip[]; onRemove: (chip: VibeChip) => void }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.heardStrip}
      contentContainerStyle={styles.heard}
      testID="vibe-heard">
      <T variant="label" color="ink4" style={styles.heardLabel}>
        Thrum heard
      </T>
      {chips.map((chip, i) => {
        const look = chipLook(chip);
        return (
          <Chip
            key={`${chip.kind}:${chip.label}`}
            label={look.label}
            icon={look.icon}
            selected={look.color !== undefined}
            color={look.color}
            size="sm"
            removable
            onPress={() => onRemove(chip)}
            testID={`vibe-chip-${i}`}
          />
        );
      })}
    </ScrollView>
  );
}

/** Its own component so the analyser's countdown only re-renders the title, not the results. */
function VibeHeader({ y, metrics }: { y: SharedValue<number>; metrics: HeaderMetrics }) {
  const remaining = useFeatures((s) => (s.running ? s.remaining : 0));
  return (
    <LargeHeader
      y={y}
      metrics={metrics}
      title="Vibe"
      kicker="Search by name or feel"
      subtitle={remaining > 0 ? `Still listening to your library \u00b7 ${formatNumber(remaining)} to go` : undefined}
      testID="vibe-header"
    />
  );
}

export default function VibeScreen() {
  const c = useTheme();
  const { ref, y } = useScrollY();
  const metrics = useHeaderMetrics();
  const { bar, large, collapseAt } = metrics;
  const bottom = useBottomChrome(true);
  const { height } = useWindowDimensions();
  const [viewH, setViewH] = useState(height);
  const input = useRef<TextInputInstance>(null);
  const navigation = useNavigation<BottomTabNavigationProp<Record<string, object | undefined>>>();

  const ctx = useVibeContext();
  const index = useSearchIndex();
  const analysing = useFeatures((s) => s.running);
  const searchFocus = useUi((s) => s.searchFocus);
  const { lib } = ctx;
  const hasMusic = lib.tracks.length > 0;

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  // Typing stays instant; the results catch up a beat later and can be interrupted by the next key.
  const deferred = useDeferredValue(query);
  const text = hasMusic ? deferred.trim() : '';
  const searching = text.length > 0;

  const vibe = useMemo(() => parseVibe(text, new Date(ctx.now), lib), [text, ctx.now, lib]);
  const vibeOn = vibe.chips.some((ch) => ch.kind !== 'text');
  const ranked = useMemo(() => (vibeOn ? rankByVibe(vibe, ctx).map((r) => r.id) : []), [vibeOn, vibe, ctx]);
  // "chill arijit" names no song as a whole, so the words the parser left over get a search of their own.
  const found = useMemo(() => {
    if (!text) return null;
    const all = search(index, text);
    if (all.top || !vibeOn || !vibe.text) return { res: all, partial: null };
    const rest = vibe.chips.find((ch) => ch.kind === 'text')?.label ?? vibe.text;
    return { res: search(index, vibe.text), partial: rest };
  }, [index, text, vibeOn, vibe]);
  const top = useMemo(() => (found ? resolveTop(found.res, lib) : null), [found, lib]);
  // A vibe leads, unless the words are also exactly the name of something ("Happy", a playlist called "Workout").
  const textFirst = !vibeOn || (top !== null && found?.partial === null && isExactName(top, text));

  const res = found?.res;
  const topTrack = top?.kind === 'track' ? top.id : null;
  const songs = (res?.tracks ?? []).filter((t) => t.id !== topTrack);
  const songIds = topTrack ? [topTrack, ...songs.map((t) => t.id)] : songs.map((t) => t.id);
  const offset = topTrack ? 1 : 0;
  const artists = (res?.artists ?? []).filter((a) => !(top?.kind === 'artist' && a.id === top.id)).slice(0, ARTISTS);
  const albums = (res?.albums ?? []).filter((a) => !(top?.kind === 'album' && a.id === top.id)).slice(0, ALBUMS);
  const playlists = (res?.playlists ?? []).filter((p) => !(top?.kind === 'playlist' && p.id === top.id)).slice(0, COLLECTIONS);
  const genres = (res?.genres ?? []).filter((g) => !(top?.kind === 'genre' && g.id === top.id)).slice(0, COLLECTIONS);
  const textCount = (top ? 1 : 0) + songs.length + artists.length + albums.length + playlists.length + genres.length;
  const anything = ranked.length > 0 || textCount > 0;
  const showAll = expanded === text;
  // Naming one song is often where you want to start, so what sounds like it comes next (its radio, as on Home).
  const alikeOf = !vibeOn && top?.kind === 'track' ? top.track : null;
  const radio = useMemo(() => (alikeOf ? [alikeOf.id, ...similarTracks(alikeOf.id, ctx, 49).map((r) => r.id)] : []), [alikeOf, ctx]);
  const listed = new Set(songIds);
  const alike = radio
    .slice(1)
    .filter((id) => !listed.has(id))
    .slice(0, ALIKE);

  const searchSource: PlaySource = { kind: 'search', id: text, label: `\u201c${text}\u201d` };
  const vibeSource: PlaySource = { kind: 'vibe', id: text, label: describeVibe(vibe) };

  // Playing something is the clearest sign the search found what you wanted.
  const used = () => {
    rememberSearch(text);
    Keyboard.dismiss();
  };
  const playSong = (i: number) => {
    const s = usePlayer.getState();
    if (s.source?.kind === 'search' && s.trackId === songIds[i]) {
      openPlayer();
      return;
    }
    if (player.playIds(songIds, i, { source: searchSource })) used();
  };
  const playFit = (i: number) => {
    const s = usePlayer.getState();
    if (s.source?.kind === 'vibe' && s.source.id === text && s.trackId === ranked[i]) {
      openPlayer();
      return;
    }
    if (player.playIds(ranked, i, { source: vibeSource })) used();
  };
  const playAlike = (i: number) => {
    const id = alike[i];
    if (!alikeOf || !id) return;
    const s = usePlayer.getState();
    if (s.source?.kind === 'similar' && s.source.id === alikeOf.id && s.trackId === id) {
      openPlayer();
      return;
    }
    const source: PlaySource = { kind: 'similar', id: alikeOf.id, label: `Like ${alikeOf.title}` };
    if (player.playIds(radio, radio.indexOf(id), { source })) used();
  };

  const pick = (q: string) => {
    setQuery(q);
    Keyboard.dismiss();
  };
  const unsay = (chip: VibeChip) => {
    const now = new Date(ctx.now);
    const next = withoutChip(text, chip, now, lib);
    setQuery(parseVibe(next, now, lib).chips.length ? next : '');
  };
  const clear = () => {
    setQuery('');
    input.current?.focus();
  };
  const submit = () => {
    if (anything) rememberSearch(text);
  };
  // The field pins under the top bar while you type, like One UI's search pages.
  const onFocus = () => {
    if (y.get() < collapseAt - 1) scrollTo(ref, collapseAt, true);
  };

  // New words show their results from the top, with the field still pinned.
  useLayoutEffect(() => {
    if (y.get() > collapseAt + 1) scrollTo(ref, collapseAt, false);
  }, [text, y, collapseAt, ref]);

  // Tapping the Vibe tab again: back to the top first, then the keyboard.
  useEffect(
    () =>
      navigation.addListener('tabPress', (e) => {
        if (e.defaultPrevented || !navigation.isFocused()) return;
        if (y.get() > 1) {
          scrollTo(ref, 0, true);
          input.current?.blur();
        } else {
          input.current?.focus();
        }
      }),
    [navigation, y, ref],
  );

  // Search buttons elsewhere send you here with the keyboard up.
  useEffect(() => {
    if (searchFocus === handledFocus) return;
    const id = setTimeout(() => {
      handledFocus = searchFocus;
      input.current?.focus();
    }, 80);
    return () => clearTimeout(id);
  }, [searchFocus]);

  const latest = useRef({ query, text, anything });
  useEffect(() => {
    latest.current = { query, text, anything };
  });
  useFocusEffect(
    useCallback(() => {
      // Back clears the search before it leaves the app (the player and sheets get first say).
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const ui = useUi.getState();
        if (ui.playerOpen || ui.sheet || !latest.current.query) return false;
        setQuery('');
        return true;
      });
      return () => {
        sub.remove();
        // Leaving with results on screen (usually to open one of them) counts as a search worth keeping.
        if (latest.current.anything) rememberSearch(latest.current.text);
        Keyboard.dismiss();
      };
    }, []),
  );

  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: Math.max(bar, large - y.get()) }] }));
  const hairStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.get(), [collapseAt - 12, collapseAt], [0, 1], 'clamp'),
  }));

  const vibeBlock =
    vibeOn && ranked.length ? (
      <View key="vibe">
        {textFirst ? <SectionHeader kicker="Or play it as" title="A vibe" /> : null}
        <VibeCard query={text} vibe={vibe} ids={ranked} lib={lib} onPlay={used} />
        <SectionHeader
          title="Best fits"
          action={ranked.length > FITS ? { label: 'See all', onPress: () => go(vibeHref(text)) } : undefined}
        />
        {ranked.slice(0, FITS).map((id, i) => {
          const t = lib.byId.get(id);
          return t ? <TrackRow key={id} track={t} index={i} onPlay={playFit} testID={`vibe-fit-${i}`} /> : null;
        })}
      </View>
    ) : vibeOn && textCount ? (
      <View key="vibe" style={styles.inlineEmpty}>
        <EmptyState
          compact
          icon="magic-wand"
          title="Nothing fits that vibe yet"
          body={analysing ? 'Thrum is still listening to your library, and vibes sharpen as it learns.' : undefined}
        />
      </View>
    ) : null;

  const textBlock = textCount ? (
    <View key="text">
      {top ? (
        <>
          <SectionHeader kicker={found?.partial ? `Matching \u201c${clip(found.partial, 32)}\u201d` : undefined} title="Top result" />
          <TopResult top={top} lib={lib} onPlayTrack={(id) => playSong(songIds.indexOf(id))} onPlay={used} />
        </>
      ) : null}
      {songs.length ? (
        <>
          <SectionHeader
            title="Songs"
            action={
              songs.length > SONGS
                ? { label: showAll ? 'Show less' : `Show all ${songs.length}`, onPress: () => setExpanded(showAll ? null : text) }
                : undefined
            }
          />
          {(showAll ? songs : songs.slice(0, SONGS)).map((t, i) => (
            <TrackRow key={t.id} track={t} index={i + offset} onPlay={playSong} testID={`vibe-song-${i}`} />
          ))}
        </>
      ) : null}
      {artists.length ? (
        <>
          <SectionHeader title="Artists" />
          {artists.map((a, i) => (
            <ArtistRow key={a.id} artist={a} testID={`vibe-artist-${i}`} />
          ))}
        </>
      ) : null}
      {albums.length ? (
        <>
          <SectionHeader title="Albums" />
          <Shelf testID="vibe-albums">
            {albums.map((a) => (
              <AlbumTile key={a.id} album={a} size={ALBUM} testID={`vibe-album-${a.id}`} />
            ))}
          </Shelf>
        </>
      ) : null}
      {playlists.length ? (
        <>
          <SectionHeader title="Playlists" />
          {playlists.map((p) => (
            <CollectionRow
              key={p.id}
              title={p.name}
              subtitle={`Playlist \u00b7 ${formatCount(p.trackIds.length, 'song')}`}
              trackIds={p.trackIds}
              icon="playlist"
              seed={p.id}
              onPress={() => go({ pathname: '/playlist/[id]', params: { id: p.id } })}
              testID={`vibe-playlist-${p.id}`}
            />
          ))}
        </>
      ) : null}
      {genres.length ? (
        <>
          <SectionHeader title="Genres" />
          {genres.map((g) => (
            <CollectionRow
              key={g.id}
              title={g.name}
              subtitle={`Genre \u00b7 ${formatCount(g.trackIds.length, 'song')}`}
              trackIds={g.trackIds}
              icon="tag"
              seed={`genre-${g.id}`}
              onPress={() => go({ pathname: '/genre/[id]', params: { id: g.id } })}
              testID={`vibe-genre-row-${g.id}`}
            />
          ))}
        </>
      ) : null}
      {alikeOf && alike.length ? (
        <>
          <SectionHeader
            kicker="Sounds like"
            title={alikeOf.title}
            action={{ label: 'See all', onPress: () => go({ pathname: '/mix/[id]', params: { id: `similar-${alikeOf.id}` } }) }}
          />
          {alike.map((id, i) => {
            const t = lib.byId.get(id);
            return t ? <TrackRow key={id} track={t} index={i} onPlay={playAlike} testID={`vibe-alike-${i}`} /> : null;
          })}
        </>
      ) : null}
    </View>
  ) : null;

  const results = searching ? (
    <View testID="vibe-results">
      {vibeOn ? <Heard chips={vibe.chips} onRemove={unsay} /> : null}
      {anything ? (
        textFirst ? (
          [textBlock, vibeBlock]
        ) : (
          [vibeBlock, textBlock]
        )
      ) : (
        <EmptyState
          icon={vibeOn ? 'magic-wand' : 'magnifying-glass'}
          title={vibeOn ? 'Nothing fits that vibe yet' : `Nothing for \u201c${clip(text, 32)}\u201d`}
          body={
            vibeOn
              ? analysing
                ? 'Thrum is still listening to your library. Vibes sharpen as it learns how each song sounds.'
                : 'Try fewer words, or tap a chip above to take it out.'
              : 'Check the spelling, or describe a feeling instead, like \u201cchill late night\u201d.'
          }
          testID="vibe-empty"
        />
      )}
    </View>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]} onLayout={(e) => setViewH(e.nativeEvent.layout.height)} testID="vibe">
      <Animated.ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ minHeight: viewH + collapseAt }}
        testID="vibe-scroll">
        <VibeHeader y={y} metrics={metrics} />
        <View style={{ height: SEARCH_BAR_H }} />
        {hasMusic ? (
          <>
            {results}
            {/* Kept mounted while searching, so clearing the field is instant. */}
            <View style={searching ? styles.hidden : null}>
              <VibeIdle ctx={ctx} onPick={pick} />
            </View>
          </>
        ) : (
          <LibraryStatusCard />
        )}
        <View style={{ height: bottom + space.xxl }} />
      </Animated.ScrollView>
      <Animated.View style={[styles.bar, { backgroundColor: c.bg }, barStyle]}>
        <SearchField ref={input} value={query} onChangeText={setQuery} onSubmit={submit} onFocus={onFocus} onClear={clear} testID="vibe-input" />
        <Animated.View pointerEvents="none" style={[styles.hairline, { backgroundColor: c.line }, hairStyle]} />
      </Animated.View>
      <TopBar y={y} title="Vibe" collapseAt={collapseAt} flat />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SEARCH_BAR_H,
    paddingHorizontal: space.page,
    justifyContent: 'center',
  },
  hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth },
  hidden: { display: 'none' },
  heardStrip: { flexGrow: 0, marginTop: space.sm, marginBottom: space.md },
  heard: { paddingHorizontal: space.page, gap: 6, alignItems: 'center' },
  heardLabel: { marginRight: space.xs },
  inlineEmpty: { marginTop: space.lg },
});
