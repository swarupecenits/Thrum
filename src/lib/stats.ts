import { artistIdOf } from './library';
import { normalize, sortKey, compareKeys } from './text';
import { DAY_MS, dayIndex, mondayIndex } from './time';
import type { Library, PlayEvent, RankedEntry, Stats, StatsRange, TrackStat } from './types';

const SKIP_MS = 30_000;
const LONG_TRACK_MS = 8 * 60_000;

/**
 * A listen is a skip when it stopped early: under 30 s and under half the track. Long tracks
 * (8+ minutes: mixes, qawwalis, podcasts) are skips under a quarter, since 30 s means little there.
 * Unknown durations fall back to the 30 s rule.
 */
export function isSkip(playedMs: number, durationMs: number): boolean {
  if (!(playedMs > 0)) return true;
  if (!(durationMs > 0)) return playedMs < SKIP_MS;
  if (durationMs >= LONG_TRACK_MS) return playedMs < 0.25 * durationMs;
  return playedMs < SKIP_MS && playedMs < 0.5 * durationMs;
}

export function eventIsSkip(ev: PlayEvent): boolean {
  return ev.skipped || (!ev.completed && isSkip(ev.playedMs, ev.durationMs));
}

/** Skips count separately and don't move first/last played. */
export function updateTrackStat(prev: TrackStat | undefined, ev: PlayEvent): TrackStat {
  const skip = eventIsSkip(ev);
  const first = prev?.firstPlayedAt ?? null;
  const last = prev?.lastPlayedAt ?? null;
  return {
    trackId: ev.trackId,
    plays: (prev?.plays ?? 0) + (skip ? 0 : 1),
    skips: (prev?.skips ?? 0) + (skip ? 1 : 0),
    totalMs: (prev?.totalMs ?? 0) + Math.max(0, Number.isFinite(ev.playedMs) ? ev.playedMs : 0),
    firstPlayedAt: skip ? first : first === null ? ev.startedAt : Math.min(first, ev.startedAt),
    lastPlayedAt: skip ? last : last === null ? ev.startedAt : Math.max(last, ev.startedAt),
  };
}

/** Folds a play history into per-track stats. */
export function buildTrackStats(plays: PlayEvent[]): Map<string, TrackStat> {
  const out = new Map<string, TrackStat>();
  for (const ev of plays) out.set(ev.trackId, updateTrackStat(out.get(ev.trackId), ev));
  return out;
}

const RANGE_DAYS: Record<StatsRange, number> = { week: 7, month: 30, year: 365, all: Infinity };

type Tally = { label: string; plays: number; ms: number; key: string };

function bump(m: Map<string, Tally>, id: string, label: string, ms: number): void {
  const t = m.get(id);
  if (t) {
    t.plays++;
    t.ms += ms;
  } else m.set(id, { label, plays: 1, ms, key: sortKey(label) });
}

function top(m: Map<string, Tally>, n = 10): RankedEntry[] {
  return [...m.entries()]
    .sort(([ia, a], [ib, b]) => b.plays - a.plays || b.ms - a.ms || compareKeys(a.key, b.key) || (ia < ib ? -1 : 1))
    .slice(0, n)
    .map(([id, t]) => ({ id, label: t.label, plays: t.plays, ms: t.ms }));
}

/** Consecutive days with a play ending today (or yesterday, so the streak survives until tonight), and the best run. */
function streaks(days: Set<number>, today: number): { current: number; longest: number } {
  let current = 0;
  const end = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  if (end !== null) while (days.has(end - current)) current++;
  let longest = 0;
  for (const d of days) {
    if (days.has(d - 1)) continue;
    let run = 1;
    while (days.has(d + run)) run++;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}

// A persona needs at least `share` of all plays inside its hours (Night owl: 35% between 22:00 and 03:00).
const SEGMENTS: { persona: string; hours: number[]; share: number }[] = [
  { persona: 'Night owl', hours: [22, 23, 0, 1, 2], share: 0.35 },
  { persona: 'Early bird', hours: [5, 6, 7, 8], share: 0.3 },
  { persona: 'Lunchtime looper', hours: [12, 13], share: 0.25 },
  { persona: 'Evening regular', hours: [17, 18, 19, 20], share: 0.4 },
];

/**
 * Names the listener after the part of the day holding an outsized share of their plays; the segment that
 * beats its threshold by the widest margin wins. Steady listening (e.g. 9-to-9) stays "All-day listener".
 */
export function personaFor(clock: number[]): string {
  const counts = Array.from({ length: 24 }, (_, h) => Math.max(0, clock[h] ?? 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total < 10) return 'Just getting started';
  let best = 'All-day listener';
  let bestLift = 0;
  for (const s of SEGMENTS) {
    const lift = s.hours.reduce((a, h) => a + counts[h], 0) / total / s.share;
    if (lift >= 1 && lift > bestLift) {
      best = s.persona;
      bestLift = lift;
    }
  }
  return best;
}

/**
 * Listening stats over a window (week = last 7 days, month = 30, year = 365, all). Streaks always use
 * the whole history up to `now`, so switching the range doesn't break them.
 */
export function computeStats(plays: PlayEvent[], lib: Library, range: StatsRange, now: number): Stats {
  const from = now - RANGE_DAYS[range] * DAY_MS;
  const tracks = new Map<string, Tally>();
  const artists = new Map<string, Tally>();
  const albums = new Map<string, Tally>();
  const genres = new Map<string, Tally>();
  const clock = new Array<number>(24).fill(0);
  const weekdays = new Array<number>(7).fill(0);
  const unique = new Set<string>();
  const days = new Set<number>();
  let ms = 0;
  let count = 0;
  let skips = 0;
  for (const ev of plays) {
    if (!(ev.startedAt <= now)) continue;
    const skip = eventIsSkip(ev);
    if (!skip) days.add(dayIndex(ev.startedAt));
    if (ev.startedAt < from) continue;
    const played = Math.max(0, Number.isFinite(ev.playedMs) ? ev.playedMs : 0);
    ms += played;
    if (skip) {
      skips++;
      continue;
    }
    count++;
    unique.add(ev.trackId);
    const d = new Date(ev.startedAt);
    clock[d.getHours()]++;
    weekdays[mondayIndex(d)]++;
    const t = lib.byId.get(ev.trackId);
    if (!t) continue;
    bump(tracks, t.id, t.title, played);
    for (const name of t.artists) {
      const id = artistIdOf(name);
      bump(artists, id, lib.artistById.get(id)?.name ?? name, played);
    }
    bump(albums, t.albumId, t.album, played);
    const g = normalize(t.genre);
    if (g) bump(genres, g, t.genre, played);
  }
  const s = streaks(days, dayIndex(now));
  return {
    range,
    minutes: Math.round(ms / 60_000),
    plays: count,
    skips,
    uniqueTracks: unique.size,
    topTracks: top(tracks),
    topArtists: top(artists),
    topAlbums: top(albums),
    topGenres: top(genres),
    clock,
    weekdays,
    streakDays: s.current,
    longestStreak: s.longest,
    persona: personaFor(clock),
  };
}

/** Most played over the last 30 days (at least 2 plays). */
export function onRepeat(stats: Map<string, TrackStat>, plays: PlayEvent[], now: number, limit = 20): string[] {
  const from = now - 30 * DAY_MS;
  const counts = new Map<string, { n: number; last: number }>();
  for (const ev of plays) {
    if (ev.startedAt < from || ev.startedAt > now || eventIsSkip(ev)) continue;
    const c = counts.get(ev.trackId);
    if (c) {
      c.n++;
      c.last = Math.max(c.last, ev.startedAt);
    } else counts.set(ev.trackId, { n: 1, last: ev.startedAt });
  }
  return [...counts.entries()]
    .filter(([, c]) => c.n >= 2)
    .sort(
      ([ia, a], [ib, b]) =>
        b.n - a.n ||
        (stats.get(ib)?.plays ?? 0) - (stats.get(ia)?.plays ?? 0) ||
        b.last - a.last ||
        (ia < ib ? -1 : 1),
    )
    .slice(0, limit)
    .map(([id]) => id);
}

/** Old favourites: 3+ plays, none in the last 45 days. */
export function rediscover(stats: Map<string, TrackStat>, now: number, limit = 20): string[] {
  const cutoff = now - 45 * DAY_MS;
  return [...stats.values()]
    .filter((s) => s.plays >= 3 && s.lastPlayedAt !== null && s.lastPlayedAt <= cutoff)
    .sort(
      (a, b) =>
        b.plays - a.plays ||
        (a.lastPlayedAt ?? 0) - (b.lastPlayedAt ?? 0) ||
        (a.trackId < b.trackId ? -1 : 1),
    )
    .slice(0, limit)
    .map((s) => s.trackId);
}

/** Unique track ids, newest first; skips don't count. */
export function recentlyPlayed(plays: PlayEvent[], limit = 20): string[] {
  const sorted = plays.filter((ev) => !eventIsSkip(ev)).sort((a, b) => b.startedAt - a.startedAt);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ev of sorted) {
    if (seen.has(ev.trackId)) continue;
    seen.add(ev.trackId);
    out.push(ev.trackId);
    if (out.length >= limit) break;
  }
  return out;
}

export function recentlyAdded(lib: Library, limit = 20): string[] {
  return lib.tracks
    .slice()
    .sort((a, b) => b.dateAdded - a.dateAdded || compareKeys(sortKey(a.title), sortKey(b.title)) || (a.id < b.id ? -1 : 1))
    .slice(0, limit)
    .map((t) => t.id);
}
