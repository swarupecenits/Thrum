import { pickVaried } from './features';
import { formatCount } from './format';
import { artistIdOf, primaryArtist } from './library';
import { MOODS, classifyMoods, familyCandidates, genreFamilyLabel, moodById, moodScore, trackFamily } from './moods';
import { hashString, mulberry32 } from './random';
import { spreadShuffle } from './shuffle';
import { eventIsSkip } from './stats';
import { compareKeys, sortKey } from './text';
import { DAY_MS, HOUR_MS, WEEKDAY_NAMES, daypart, hourDistance, localDateKey } from './time';
import type { Daylist, Daypart, Mood, MoodId, PlayEvent, Track, VibeContext } from './types';

export { daypart };

type PartId = Daypart['id'];

const PART_START: Record<PartId, number> = { latenight: 0, dawn: 5, morning: 8, afternoon: 12, evening: 17, night: 21 };
/** The hour whose +/-2 h neighbourhood teaches us what this daypart sounds like. */
const PART_ANCHOR: Record<PartId, number> = { latenight: 2, dawn: 6, morning: 10, afternoon: 14, evening: 19, night: 22 };
const PART_WORDS: Record<PartId, string> = {
  latenight: 'late night',
  dawn: 'early morning',
  morning: 'morning',
  afternoon: 'afternoon',
  evening: 'evening',
  night: 'night',
};

/** Moods used before we have learned anything about this time of day. */
export const DAYPART_MOODS: Record<PartId, MoodId[]> = {
  dawn: ['acoustic', 'chill'],
  morning: ['happy', 'energetic'],
  afternoon: ['focus', 'chill'],
  evening: ['drive', 'happy'],
  night: ['romantic', 'chill'],
  latenight: ['latenight', 'sleep'],
};

const WORDS: Record<MoodId, { adj: string; noun: string }> = {
  chill: { adj: 'chill', noun: 'unwind' },
  energetic: { adj: 'high-energy', noun: 'warm-up' },
  happy: { adj: 'feel-good', noun: 'sunshine' },
  sad: { adj: 'melancholy', noun: 'heartache' },
  romantic: { adj: 'romantic', noun: 'love songs' },
  focus: { adj: 'focused', noun: 'focus' },
  party: { adj: 'party', noun: 'party starters' },
  workout: { adj: 'pumped-up', noun: 'workout' },
  latenight: { adj: 'after-hours', noun: 'after dark' },
  devotional: { adj: 'devotional', noun: 'bhakti' },
  bass: { adj: 'bass-heavy', noun: 'bass bangers' },
  acoustic: { adj: 'acoustic', noun: 'unplugged' },
  drive: { adj: 'cruising', noun: 'drive' },
  sleep: { adj: 'sleepy', noun: 'wind-down' },
};

const WINDOW_DAYS = 60;
const FRESH_MS = 3 * HOUR_MS;
const MIN_LEARN_PLAYS = 8;

type Learned = { moods: MoodId[]; family: string | null; windowPlays: Map<string, number>; totals: Map<string, number> };

function learn(ctx: VibeContext, plays: PlayEvent[], start: number, part: PartId): Learned {
  const from = start - WINDOW_DAYS * DAY_MS;
  const anchor = PART_ANCHOR[part];
  const windowPlays = new Map<string, number>();
  const totals = new Map<string, number>();
  const votes = new Map<MoodId, number>();
  const families = new Map<string, number>();
  let n = 0;
  for (const ev of plays) {
    if (ev.startedAt >= start || eventIsSkip(ev)) continue;
    totals.set(ev.trackId, (totals.get(ev.trackId) ?? 0) + 1);
    if (ev.startedAt < from || hourDistance(new Date(ev.startedAt).getHours(), anchor) > 2) continue;
    const t = ctx.lib.byId.get(ev.trackId);
    if (!t) continue;
    n++;
    windowPlays.set(t.id, (windowPlays.get(t.id) ?? 0) + 1);
    classifyMoods(t, ctx.features.get(t.id)).forEach((m, i) => votes.set(m, (votes.get(m) ?? 0) + (i === 0 ? 1 : 0.7)));
    const fam = trackFamily(t);
    if (fam) families.set(fam, (families.get(fam) ?? 0) + 1);
  }
  const defaults = DAYPART_MOODS[part];
  let moods: MoodId[] = [];
  if (n >= MIN_LEARN_PLAYS) {
    moods = [...votes.entries()]
      .filter(([, v]) => v >= 3)
      .sort((a, b) => b[1] - a[1] || MOODS.findIndex((m) => m.id === a[0]) - MOODS.findIndex((m) => m.id === b[0]))
      .slice(0, 2)
      .map(([m]) => m);
  }
  if (!moods.length) moods = defaults.slice();
  else if (moods.length === 1) moods.push(defaults.find((m) => m !== moods[0]) ?? defaults[0]);
  let family: string | null = null;
  const topFamily = [...families.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (topFamily && topFamily[1] >= 3 && topFamily[1] / Math.max(1, n) >= 0.3) family = topFamily[0];
  return { moods, family, windowPlays, totals };
}

function composeTitle(weekday: string, part: PartId, moods: MoodId[], family: string | null, seed: number): string {
  const when = `${weekday} ${PART_WORDS[part]}`;
  // "after-hours" on a late-night list says the same thing twice; lead with the other mood.
  const lead = moods[0] === 'latenight' && (part === 'latenight' || part === 'night') && moods[1] ? moods[1] : moods[0];
  const other = moods.find((m) => m !== lead) ?? lead;
  const w = WORDS[lead];
  if (family) {
    const fam = genreFamilyLabel(family).toLowerCase();
    return seed % 2 === 0 ? `${when} ${w.adj} ${fam}` : `${when} ${fam} ${w.noun}`;
  }
  if (other === lead || WORDS[other].noun === w.adj) return `${when} ${w.noun}`;
  return `${when} ${w.adj} ${WORDS[other].noun}`;
}

/** Per-track jitter in 0..1 that depends only on the seed and the id, not the library order. */
function jitter(seed: number, id: string): number {
  return hashString(`${seed}|${id}`) / 4294967296;
}

/**
 * Spotify-style daylist for the current daypart. History is read up to the start of the daypart,
 * so the list (and its title) stays the same until the next daypart begins.
 */
export function buildDaylist(ctx: VibeContext, plays: PlayEvent[], now: Date, size = 40): Daylist {
  const part = daypart(now);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), PART_START[part.id]).getTime();
  const seed = hashString(`daylist|${localDateKey(now)}|${part.id}`);
  const learned = learn(ctx, plays, start, part.id);
  const moods = learned.moods.map(moodById);
  const recent = new Set(plays.filter((ev) => ev.startedAt < start && ev.startedAt >= start - FRESH_MS).map((ev) => ev.trackId));
  const good: { t: Track; score: number; key: string }[] = [];
  const rest: { t: Track; score: number; key: string }[] = [];
  for (const t of ctx.lib.tracks) {
    if (recent.has(t.id)) continue;
    const f = ctx.features.get(t.id);
    const fits = moods.map((m) => moodScore(m, t, f));
    const fit = 0.6 * Math.max(...fits) + 0.4 * (fits.reduce((a, b) => a + b, 0) / fits.length);
    const inWindow = learned.windowPlays.get(t.id) ?? 0;
    const total = learned.totals.get(t.id) ?? 0;
    const affinity = 0.6 * Math.min(1, inWindow / 5) + 0.4 * Math.min(1, Math.log2(1 + total) / 5);
    const family = learned.family && familyCandidates(t).includes(learned.family) ? 1 : 0;
    const stat = ctx.stats.get(t.id);
    const skippy = stat && stat.skips >= 3 && stat.skips > stat.plays ? 0.7 : 1;
    const score = (0.55 * fit + 0.25 * affinity + 0.15 * family + 0.1 * jitter(seed, t.id)) * skippy;
    (fit >= 0.3 ? good : rest).push({ t, score, key: sortKey(t.title) });
  }
  const order = (a: { t: Track; score: number; key: string }, b: { t: Track; score: number; key: string }) =>
    b.score - a.score || compareKeys(a.key, b.key) || (a.t.id < b.t.id ? -1 : 1);
  const n = Math.max(0, Math.floor(size));
  const picked = pickVaried([...good.sort(order), ...rest.sort(order)], n, 3, Math.max(2, Math.ceil(n / 10)));
  const trackIds = spreadShuffle(
    picked.map((p) => p.t),
    mulberry32(seed),
  ).map((t) => t.id);
  return {
    title: composeTitle(WEEKDAY_NAMES[now.getDay()], part.id, learned.moods, learned.family, seed),
    subtitle: `Made for your ${PART_WORDS[part.id]} \u00b7 ${formatCount(trackIds.length, 'song')}`,
    daypart: part,
    moods: learned.moods,
    trackIds,
  };
}

const MIX_MIN_ANALYSED = 0.62;
const MIX_MIN_PRIOR = 0.5;

/** One mix per mood that has at least 8 strong tracks, strongest mixes first. */
export function moodMixes(ctx: VibeContext, size = 30): { mood: Mood; trackIds: string[] }[] {
  const n = Math.max(1, Math.floor(size));
  const mixes: { mood: Mood; trackIds: string[]; strength: number; order: number }[] = [];
  MOODS.forEach((mood, order) => {
    const ranked = ctx.lib.tracks
      .map((t) => ({ t, score: moodScore(mood, t, ctx.features.get(t.id)), key: sortKey(t.title) }))
      // Unanalysed tracks are capped at 0.6 by moodScore, so they need a lower bar to count.
      .filter((r) => r.score >= (ctx.features.has(r.t.id) ? MIX_MIN_ANALYSED : MIX_MIN_PRIOR))
      .sort((a, b) => b.score - a.score || compareKeys(a.key, b.key) || (a.t.id < b.t.id ? -1 : 1));
    if (ranked.length < 8) return;
    const picked = pickVaried(ranked, n, 4, Math.max(3, Math.ceil(n / 8)));
    const mean = picked.reduce((s, r) => s + r.score, 0) / picked.length;
    mixes.push({
      mood,
      trackIds: picked.map((r) => r.t.id),
      strength: mean + 0.1 * Math.min(1, ranked.length / n),
      order,
    });
  });
  return mixes
    .sort((a, b) => b.strength - a.strength || a.order - b.order)
    .map(({ mood, trackIds }) => ({ mood, trackIds }));
}

/** Artist key used by the daylist spread, exported for UI grouping. */
export function daylistArtistKey(t: Track): string {
  return artistIdOf(primaryArtist(t));
}
