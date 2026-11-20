import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { BackButton } from '@/components/back-button';
import { Chip } from '@/components/buttons';
import { Card, CardHeader } from '@/components/card';
import { Cover } from '@/components/cover';
import { EmptyState } from '@/components/empty-state';
import { LargeHeader, SectionHeader, TopBar, useHeaderMetrics, useScrollY } from '@/components/header';
import { Icon, type IconName } from '@/components/icon';
import { useBottomChrome } from '@/components/layout';
import { go } from '@/components/nav';
import { Press } from '@/components/press';
import { AlbumTile } from '@/components/rows';
import { Segmented, type SegmentOption } from '@/components/segmented';
import { Shelf } from '@/components/shelf';
import { T } from '@/components/text';
import { useClock } from '@/hooks/use-clock';
import { withAlpha } from '@/lib/color';
import { formatCount, formatNumber, formatShortDate, formatTotalDuration } from '@/lib/format';
import { computeStats, eventIsSkip } from '@/lib/stats';
import { DAY_MS, dayIndex, HOUR_MS, MINUTE_MS } from '@/lib/time';
import type { Album, PlayEvent, RankedEntry, StatsRange } from '@/lib/types';
import { useHistory } from '@/stores/history';
import { useLibrary } from '@/stores/library';
import { player } from '@/stores/player';
import { openSheet } from '@/stores/ui';
import { radius, space, useTheme } from '@/theme';
import { haptic } from '@/utils/haptics';

const RANGES: readonly SegmentOption<StatsRange>[] = [
  { value: 'week', label: 'Week', a11y: 'Last 7 days' },
  { value: 'month', label: 'Month', a11y: 'Last 30 days' },
  { value: 'year', label: 'Year', a11y: 'Last 12 months' },
  { value: 'all', label: 'All time' },
];

const RANGE_DAYS: Record<StatsRange, number> = { week: 7, month: 30, year: 365, all: Infinity };
const RANGE_KICKER: Record<StatsRange, string> = {
  week: 'Last 7 days',
  month: 'Last 30 days',
  year: 'Last 12 months',
  all: 'All time',
};
const RANGE_SPAN: Record<StatsRange, string> = {
  week: 'in the last 7 days',
  month: 'in the last 30 days',
  year: 'in the last 12 months',
  all: 'yet',
};

const PERSONAS: Record<string, { icon: IconName; blurb: string }> = {
  'Night owl': { icon: 'moon', blurb: 'Most of your listening happens after 10 pm.' },
  'Early bird': { icon: 'sun-horizon', blurb: 'You start the day with music, well before nine.' },
  'Lunchtime looper': { icon: 'coffee', blurb: 'Lunch breaks are for music.' },
  'Evening regular': { icon: 'cloud-moon', blurb: 'Your evenings belong to music.' },
  'All-day listener': { icon: 'sun', blurb: 'Music all day long, no favourite hour.' },
  'Just getting started': { icon: 'sparkle', blurb: 'A few more plays and Thrum names your listening style.' },
};

const WEEKDAY_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const WEEKDAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const CLOCK_AXIS = ['12 am', '6 am', '12 pm', '6 pm'];

const TOP_N = 5;
const CHART_H = 88;
const MIN_BAR = 3;
const BAR_EASE = Easing.bezier(0.22, 1, 0.36, 1);

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return 'midnight';
  if (h === 12) return 'noon';
  return h < 12 ? `${h} am` : `${h - 12} pm`;
}

function firstListen(plays: PlayEvent[]): number | null {
  let first: number | null = null;
  for (const ev of plays) if (!eventIsSkip(ev) && (first === null || ev.startedAt < first)) first = ev.startedAt;
  return first;
}

function listenedSince(plays: PlayEvent[], from: number): boolean {
  return plays.some((ev) => ev.startedAt >= from && !eventIsSkip(ev));
}

function peakOf(values: number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

/** One column of a chart; grows from the baseline whenever its value changes. */
function Bar({ frac, color }: { frac: number; color: string }) {
  const h = useSharedValue(MIN_BAR);
  useEffect(() => {
    h.set(withTiming(Math.max(MIN_BAR, frac * CHART_H), { duration: 520, easing: BAR_EASE }));
  }, [frac, h]);
  const style = useAnimatedStyle(() => ({ height: h.get() }));
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

function Bars({ values, gap }: { values: number[]; gap: number }) {
  const c = useTheme();
  const max = Math.max(1, ...values);
  return (
    <View style={[styles.bars, { gap }]}>
      {values.map((v, i) => (
        <Bar key={i} frac={v / max} color={v === 0 ? c.fill : v === max ? c.accent : c.ink4} />
      ))}
    </View>
  );
}

function ClockChart({ clock }: { clock: number[] }) {
  const peak = peakOf(clock);
  return (
    <Card testID="stats-clock">
      <CardHeader kicker="By hour" title="When you listen" detail={`Busiest around ${hourLabel(peak)}`} />
      <View accessible accessibilityRole="image" accessibilityLabel={`Plays by hour of day. Busiest around ${hourLabel(peak)}, ${formatCount(clock[peak], 'play')}.`}>
        <Bars values={clock} gap={3} />
        <View style={styles.axis}>
          {CLOCK_AXIS.map((label) => (
            <T key={label} variant="mono" color="ink4" style={styles.axisLabel}>
              {label}
            </T>
          ))}
        </View>
      </View>
    </Card>
  );
}

function WeekChart({ weekdays }: { weekdays: number[] }) {
  const peak = peakOf(weekdays);
  return (
    <Card testID="stats-weekdays">
      <CardHeader kicker="By day" title="Your week" detail={`${WEEKDAY_PLURAL[peak]} are when you listen most`} />
      <View accessible accessibilityRole="image" accessibilityLabel={`Plays by weekday. ${WEEKDAY_PLURAL[peak]} lead with ${formatCount(weekdays[peak], 'play')}.`}>
        <Bars values={weekdays} gap={space.md} />
        <View style={[styles.axis, { gap: space.md }]}>
          {WEEKDAY_SHORT.map((label, i) => (
            <T key={i} variant="mono" color={i === peak ? 'accent' : 'ink4'} align="center" style={styles.axisLabel}>
              {label}
            </T>
          ))}
        </View>
      </View>
    </Card>
  );
}

type Tile = { icon: IconName; value: string; unit?: string; label: string; testID: string };

function StatTile({ icon, value, unit, label, testID }: Tile) {
  const c = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: c.surface, borderColor: c.line }]} testID={testID}>
      <Icon name={icon} size={20} color={c.ink3} weight="duotone" />
      <View style={styles.tileValue}>
        <T variant="title" tabular numberOfLines={1}>
          {value}
        </T>
        {unit ? (
          <T variant="callout" color="ink3">
            {unit}
          </T>
        ) : null}
      </View>
      <T variant="small" color="ink3" numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

type RankArt = { albumId: string; trackId: string; label: string; round?: boolean; seed?: string };

type RankRowProps = {
  rank: number;
  title: string;
  subtitle: string;
  plays: number;
  /** Plays relative to the leader, 0..1. */
  share: number;
  art: RankArt | null;
  onPress?: () => void;
  onLongPress?: () => void;
  testID?: string;
};

function RankRow({ rank, title, subtitle, plays, share, art, onPress, onLongPress, testID }: RankRowProps) {
  const c = useTheme();
  const lead = rank === 1;
  return (
    <Press
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () => {
              haptic('soft');
              onLongPress();
            }
          : undefined
      }
      delayLongPress={320}
      disabled={!onPress}
      scale={0.985}
      haptic={onPress ? 'tap' : false}
      accessibilityLabel={`Number ${rank}, ${title}, ${subtitle}, ${formatCount(plays, 'play')}`}
      testID={testID}
      style={styles.rank}>
      <T variant="mono" color={lead ? 'accent' : 'ink4'} tabular style={styles.rankNo}>
        {String(rank).padStart(2, '0')}
      </T>
      {art ? (
        <Cover albumId={art.albumId} trackId={art.trackId} label={art.label} size={48} rounded={art.round ? 24 : 8} seed={art.seed} />
      ) : (
        <View style={[styles.rankBlank, { backgroundColor: c.surface2 }]}>
          <Icon name="music-note" size={18} color={c.ink3} />
        </View>
      )}
      <View style={styles.rankText}>
        <T variant="bodyMedium" numberOfLines={1}>
          {title}
        </T>
        <T variant="small" color="ink3" numberOfLines={1}>
          {subtitle}
        </T>
        <View style={[styles.meter, { backgroundColor: c.fill }]}>
          <View style={[styles.meterFill, { width: `${Math.round(Math.max(0.04, share) * 100)}%`, backgroundColor: lead ? c.accent : c.lineStrong }]} />
        </View>
      </View>
      <T variant="mono" color="ink3" tabular>
        {formatNumber(plays)}
      </T>
    </Press>
  );
}

const coverOf = (album: Album | undefined, label: string, round?: boolean, seed?: string): RankArt | null =>
  album ? { albumId: album.id, trackId: album.coverTrackId, label, round, seed } : null;

export default function StatsScreen() {
  const c = useTheme();
  const { ref, y } = useScrollY();
  const metrics = useHeaderMetrics();
  const bottom = useBottomChrome(false);
  const lib = useLibrary((s) => s.lib);
  const plays = useHistory((s) => s.plays);
  // The clock is floored to the hour; counting to the end of it keeps this hour's plays in.
  const now = useClock(HOUR_MS) + HOUR_MS - 1;
  const [range, setRange] = useState<StatsRange>(() => (listenedSince(plays, now - 7 * DAY_MS) ? 'week' : 'all'));
  const stats = useMemo(() => computeStats(plays, lib, range, now), [plays, lib, range, now]);
  const first = useMemo(() => firstListen(plays), [plays]);
  const genreIds = useMemo(() => new Set(lib.genres.map((g) => g.id)), [lib.genres]);

  const topTracks = stats.topTracks.filter((e) => lib.byId.has(e.id));
  const topIds = topTracks.map((e) => e.id);
  const topAlbums = stats.topAlbums.flatMap((entry) => {
    const album = lib.albumById.get(entry.id);
    return album ? [{ entry, album }] : [];
  });
  const listened = stats.plays > 0;
  const persona = PERSONAS[stats.persona] ?? PERSONAS['All-day listener'];
  const spanDays = first === null ? 1 : Math.min(RANGE_DAYS[range], Math.max(1, dayIndex(now) - dayIndex(first) + 1));
  const perDayMs = (stats.minutes * MINUTE_MS) / spanDays;
  const heard = stats.plays + stats.skips;
  const skipRate = heard ? Math.round((stats.skips / heard) * 100) : 0;
  const kicker = range === 'all' && first !== null ? `Since ${formatShortDate(first, now)}` : RANGE_KICKER[range];
  const hasMusic = lib.tracks.length > 0;

  const playTop = (index: number) => player.playIds(topIds, index, { source: { kind: 'history', label: 'Your top songs' } });
  const rankShare = (list: RankedEntry[], e: RankedEntry) => (list[0]?.plays ? e.plays / list[0].plays : 0);

  const tiles: Tile[] = [
    { icon: 'fire', value: String(stats.streakDays), unit: stats.streakDays === 1 ? 'day' : 'days', label: 'Current streak', testID: 'stats-streak' },
    { icon: 'trophy', value: String(stats.longestStreak), unit: stats.longestStreak === 1 ? 'day' : 'days', label: 'Longest streak', testID: 'stats-longest' },
    { icon: 'music-notes', value: formatNumber(stats.uniqueTracks), label: stats.uniqueTracks === 1 ? 'Song' : 'Different songs', testID: 'stats-unique' },
    { icon: 'skip-forward', value: `${skipRate}%`, label: `Skipped \u00b7 ${formatCount(stats.skips, 'skip')}`, testID: 'stats-skips' },
  ];

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <Animated.ScrollView ref={ref} showsVerticalScrollIndicator={false} testID="stats">
        <LargeHeader y={y} metrics={metrics} kicker={kicker} title="Your listening" testID="stats-header" />
        <Segmented options={RANGES} value={range} onChange={setRange} label="Time range" style={styles.range} testID="stats-range" />

        {first === null ? (
          <EmptyState
            icon="chart-bar"
            title="Your story starts with a song"
            body="Play some music and Thrum keeps count: minutes, streaks, favourite artists and the hours you listen most."
            action={
              hasMusic
                ? {
                    label: 'Shuffle all',
                    icon: 'shuffle',
                    onPress: () =>
                      player.playIds(lib.tracks.map((t) => t.id), -1, { shuffle: true, source: { kind: 'library', label: 'All songs' } }),
                  }
                : { label: 'Open library', icon: 'vinyl-record', onPress: () => go('/library', 'navigate') }
            }
            testID="stats-empty"
          />
        ) : !listened ? (
          <EmptyState
            compact
            icon="calendar-blank"
            title="A quiet stretch"
            body={`Nothing played ${RANGE_SPAN[range]}.`}
            action={{ label: 'See all time', onPress: () => setRange('all') }}
            testID="stats-quiet"
          />
        ) : (
          <>
            <Card style={styles.hero} testID="stats-hero">
              <LinearGradient
                colors={[withAlpha(c.accent, 0.2), withAlpha(c.accent, 0)]}
                start={{ x: 1, y: 0 }}
                end={{ x: 0.2, y: 0.9 }}
                style={StyleSheet.absoluteFill}
              />
              <T variant="label" color="ink3">
                Minutes listened
              </T>
              <T variant="hero" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} testID="stats-minutes">
                {formatNumber(stats.minutes)}
              </T>
              <T variant="callout" color="ink2">
                {`${formatTotalDuration(stats.minutes * MINUTE_MS)} \u00b7 ${formatCount(stats.plays, 'play')}`}
              </T>
              {spanDays > 1 ? (
                <T variant="small" color="ink3">
                  {`About ${formatTotalDuration(perDayMs)} a day`}
                </T>
              ) : null}
              <View style={[styles.persona, { backgroundColor: c.fill, borderColor: c.line }]}>
                <View style={[styles.personaIcon, { backgroundColor: c.accent }]}>
                  <Icon name={persona.icon} size={20} color={c.onAccent} weight="fill" />
                </View>
                <View style={styles.flex}>
                  <T variant="headline" numberOfLines={1}>
                    {stats.persona}
                  </T>
                  <T variant="small" color="ink3" numberOfLines={2}>
                    {persona.blurb}
                  </T>
                </View>
              </View>
            </Card>

            <View style={styles.tiles}>
              {tiles.map((t) => (
                <StatTile key={t.testID} {...t} />
              ))}
            </View>

            {stats.topArtists.length ? (
              <>
                <SectionHeader kicker="On top" title="Top artists" />
                {stats.topArtists.slice(0, TOP_N).map((e, i) => {
                  const artist = lib.artistById.get(e.id);
                  const album = artist?.albumIds[0] ? lib.albumById.get(artist.albumIds[0]) : undefined;
                  return (
                    <RankRow
                      key={e.id}
                      rank={i + 1}
                      title={e.label}
                      subtitle={formatTotalDuration(e.ms)}
                      plays={e.plays}
                      share={rankShare(stats.topArtists, e)}
                      art={coverOf(album, e.label, true, e.id)}
                      onPress={artist ? () => go({ pathname: '/artist/[id]', params: { id: e.id } }) : undefined}
                      testID={`stats-artist-${i}`}
                    />
                  );
                })}
              </>
            ) : null}

            {topTracks.length ? (
              <>
                <SectionHeader kicker="On repeat" title="Top songs" action={{ label: 'Play all', onPress: () => playTop(0) }} />
                {topTracks.slice(0, TOP_N).map((e, i) => {
                  const t = lib.byId.get(e.id);
                  if (!t) return null;
                  return (
                    <RankRow
                      key={e.id}
                      rank={i + 1}
                      title={t.title}
                      subtitle={t.artist}
                      plays={e.plays}
                      share={rankShare(topTracks, e)}
                      art={{ albumId: t.albumId, trackId: t.id, label: t.album }}
                      onPress={() => playTop(i)}
                      onLongPress={() => openSheet({ kind: 'track', trackId: t.id })}
                      testID={`stats-track-${i}`}
                    />
                  );
                })}
              </>
            ) : null}

            <View style={styles.charts}>
              <ClockChart clock={stats.clock} />
              <WeekChart weekdays={stats.weekdays} />
            </View>

            {topAlbums.length ? (
              <>
                <SectionHeader kicker="Start to finish" title="Top albums" />
                <Shelf testID="stats-albums">
                  {topAlbums.map(({ entry, album }) => (
                    <AlbumTile key={entry.id} album={album} size={136} subtitle={formatCount(entry.plays, 'play')} testID={`stats-album-${entry.id}`} />
                  ))}
                </Shelf>
              </>
            ) : null}

            {stats.topGenres.length ? (
              <>
                <SectionHeader kicker="Your sound" title="Top genres" />
                <View style={styles.chips}>
                  {stats.topGenres.slice(0, 8).map((g, i) => (
                    <Chip
                      key={g.id}
                      label={`${g.label} \u00b7 ${formatNumber(g.plays)}`}
                      selected={i === 0}
                      onPress={genreIds.has(g.id) ? () => go({ pathname: '/genre/[id]', params: { id: g.id } }) : undefined}
                      testID={`stats-genre-${i}`}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <View style={styles.footnote}>
              <Icon name="lock" size={14} color={c.ink4} />
              <T variant="small" color="ink4" style={styles.flex}>
                Counted on your phone. Nothing about your listening ever leaves it.
              </T>
            </View>
          </>
        )}
        <View style={{ height: bottom + space.xxl }} />
      </Animated.ScrollView>
      <TopBar y={y} title="Your listening" collapseAt={metrics.collapseAt} left={<BackButton />} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  range: { marginHorizontal: space.page, marginBottom: space.lg },
  hero: { gap: space.xs, paddingVertical: space.xl },
  persona: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  personaIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.page, marginTop: space.md },
  tile: {
    flexGrow: 1,
    flexBasis: '40%',
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tileValue: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: space.sm },
  rank: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.page, paddingVertical: space.sm },
  rankNo: { width: 22 },
  rankBlank: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rankText: { flex: 1, gap: 2 },
  meter: { height: 3, borderRadius: 2, marginTop: 5, overflow: 'hidden' },
  meterFill: { height: 3, borderRadius: 2 },
  charts: { gap: space.md, marginTop: space.xxl },
  bars: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_H },
  bar: { flex: 1, borderRadius: 3 },
  axis: { flexDirection: 'row', marginTop: space.sm },
  axisLabel: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.page },
  footnote: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.page, marginTop: space.xxl },
});
