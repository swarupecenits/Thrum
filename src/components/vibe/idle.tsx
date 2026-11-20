import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Chip } from '../buttons';
import { SectionHeader } from '../header';
import { Icon } from '../icon';
import { MoodTile } from '../mood-tile';
import { T } from '../text';
import { MoodMap } from './mood-map';
import { MAX_QUERY } from './search-field';
import { useNowTrack } from '@/hooks/use-library';
import { moodMixes } from '@/lib/daylist';
import { formatCount } from '@/lib/format';
import { MOODS } from '@/lib/moods';
import type { Mood, VibeContext } from '@/lib/types';
import { parseVibe, VIBE_EXAMPLES } from '@/lib/vibe';
import { player } from '@/stores/player';
import { clearSearches, useSearches } from '@/stores/searches';
import { space, useBase } from '@/theme';

const RECENT = 5;
const GENRES = 12;
const MOOD_H = 88;

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}\u2026` : s;
}

type Prompt = { query: string; label: string; similar?: boolean };

type VibeIdleProps = {
  ctx: VibeContext;
  /** Puts words in the search field. */
  onPick: (query: string) => void;
};

/** What the Vibe tab offers before you type: recent searches, things to say, the mood map and moods to browse. */
export function VibeIdle({ ctx, onPick }: VibeIdleProps) {
  const c = useBase();
  const { width } = useWindowDimensions();
  const recent = useSearches((s) => s.recent);
  const nowTrack = useNowTrack();
  const { lib } = ctx;

  const recentRows = useMemo(() => {
    const date = new Date(ctx.now);
    return recent.slice(0, RECENT).map((query) => ({
      query,
      vibe: parseVibe(query, date, lib).chips.some((ch) => ch.kind !== 'text'),
    }));
  }, [recent, ctx.now, lib]);

  // "Songs like <what's playing>" leads the prompts, when the parser can find that song again.
  const prompts = useMemo(() => {
    const out: Prompt[] = [];
    if (nowTrack) {
      const query = `songs like ${nowTrack.title}`;
      if (query.length <= MAX_QUERY && parseVibe(query, new Date(ctx.now), lib).similarTo) {
        out.push({ query, label: `Songs like ${clip(nowTrack.title, 26)}`, similar: true });
      }
    }
    for (const query of VIBE_EXAMPLES) out.push({ query, label: query });
    return out;
  }, [nowTrack, ctx.now, lib]);
  const half = Math.ceil(prompts.length / 2);
  const promptRows = [prompts.slice(0, half), prompts.slice(half)];

  const mixes = useMemo(() => moodMixes(ctx), [ctx]);
  // A young or unanalysed library may only fill a few moods; still offer every one to browse.
  const moods: { mood: Mood; trackIds: string[] | null }[] =
    mixes.length >= 4 ? mixes : MOODS.map((mood) => ({ mood, trackIds: mixes.find((m) => m.mood.id === mood.id)?.trackIds ?? null }));
  const tileW = Math.floor((width - space.page * 2 - space.md) / 2);

  const genres = useMemo(
    () => [...lib.genres].sort((a, b) => b.trackIds.length - a.trackIds.length || (a.name < b.name ? -1 : 1)).slice(0, GENRES),
    [lib.genres],
  );

  return (
    <View testID="vibe-idle">
      {recentRows.length ? (
        <>
          <SectionHeader title="Recent" action={{ label: 'Clear', onPress: clearSearches }} />
          {recentRows.map((r, i) => (
            <Pressable
              key={r.query}
              onPress={() => onPick(r.query)}
              accessibilityRole="button"
              accessibilityLabel={`Search again: ${r.query}`}
              testID={`vibe-recent-${i}`}
              style={({ pressed }) => [styles.recent, pressed && { backgroundColor: c.fill }]}>
              <Icon name={r.vibe ? 'sparkle' : 'clock'} size={18} color={c.ink3} />
              <T variant="body" color="ink2" numberOfLines={1} style={styles.flex}>
                {r.query}
              </T>
            </Pressable>
          ))}
        </>
      ) : null}

      <SectionHeader kicker="Say how it should feel" title="Try saying" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.prompts}
        testID="vibe-prompts">
        <View style={styles.promptRows}>
          {promptRows.map((row, r) => (
            <View key={r} style={styles.promptRow}>
              {row.map((p) => (
                <Chip
                  key={p.query}
                  label={p.label}
                  icon={p.similar ? 'magic-wand' : 'sparkle'}
                  selected={p.similar}
                  onPress={() => onPick(p.query)}
                  testID={p.similar ? 'vibe-prompt-similar' : undefined}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      <SectionHeader kicker="Drag the dot" title="Mood map" />
      <View style={styles.page}>
        <MoodMap ctx={ctx} />
      </View>

      <SectionHeader kicker="Moods" title="Browse by feel" />
      <View style={styles.grid}>
        {moods.map(({ mood, trackIds }) => (
          <MoodTile
            key={mood.id}
            mood={mood}
            width={tileW}
            height={MOOD_H}
            subtitle={trackIds ? formatCount(trackIds.length, 'song') : undefined}
            onPress={() => router.push({ pathname: '/mix/[id]', params: { id: `mood-${mood.id}` } })}
            onLongPress={
              trackIds ? () => player.playIds(trackIds, 0, { source: { kind: 'mood', id: mood.id, label: `${mood.label} mix` } }) : undefined
            }
            testID={`vibe-mood-${mood.id}`}
          />
        ))}
      </View>

      {genres.length ? (
        <>
          <SectionHeader kicker="In your library" title="Genres" />
          <View style={styles.wrap}>
            {genres.map((g) => (
              <Chip
                key={g.id}
                label={clip(g.name, 28)}
                icon="tag"
                onPress={() => router.push({ pathname: '/genre/[id]', params: { id: g.id } })}
                testID={`vibe-genre-${g.id}`}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  page: { paddingHorizontal: space.page },
  recent: { height: 52, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.page },
  prompts: { paddingHorizontal: space.page },
  promptRows: { gap: space.sm },
  promptRow: { flexDirection: 'row', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.page },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.page },
});
