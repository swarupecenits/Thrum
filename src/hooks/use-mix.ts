import { useMemo } from 'react';

import { useVibeContext } from './use-library';
import type { HeroArt } from '@/components/collection';
import type { IconName } from '@/components/icon';
import { MOOD_ICONS } from '@/components/mood-tile';
import { buildDaylist, moodMixes } from '@/lib/daylist';
import { similarTracks } from '@/lib/features';
import { formatCount } from '@/lib/format';
import { MOOD_IDS, moodById, moodScore } from '@/lib/moods';
import { onRepeat, recentlyAdded, recentlyPlayed, rediscover } from '@/lib/stats';
import { HOUR_MS } from '@/lib/time';
import type { Library, MoodId, PlayEvent, TrackStat, VibeContext, VibeQuery } from '@/lib/types';
import { describeVibe, parseVibe, rankByVibe } from '@/lib/vibe';
import { useHistory } from '@/stores/history';
import type { PlaySource } from '@/stores/player';

export type Mix = {
  id: string;
  kicker: string;
  title: string;
  subtitle: string;
  trackIds: string[];
  source: PlaySource;
  art: HeroArt;
  /** Shown when the mix is empty: why, and what would fill it. */
  emptyHint: string;
};

/** Generated lists that live at /mix/<id>, in the order Home shows them. */
export const MADE_FOR_YOU = ['on-repeat', 'rediscover', 'recently-added', 'recently-played'] as const;

export type ListMixId = (typeof MADE_FOR_YOU)[number];

export const MIX_INFO: Record<ListMixId, { title: string; blurb: string; icon: IconName; emptyHint: string }> = {
  'on-repeat': {
    title: 'On repeat',
    blurb: "Songs you can't stop playing",
    icon: 'fire',
    emptyHint: 'Play a few favourites over the next days and they show up here.',
  },
  rediscover: {
    title: 'Rediscover',
    blurb: "Old loves you haven't played lately",
    icon: 'clock-counter-clockwise',
    emptyHint: 'Songs you used to play a lot, then forgot, come back here.',
  },
  'recently-added': {
    title: 'Recently added',
    blurb: 'Fresh on your phone',
    icon: 'sparkle',
    emptyHint: 'New music you copy to your phone lands here.',
  },
  'recently-played': {
    title: 'Recently played',
    blurb: 'Pick up where you left off',
    icon: 'clock',
    emptyHint: 'Everything you play shows up here.',
  },
};

const MOOD_MIX_SIZE = 30;

/** Thrum's own lime-to-teal, for vibes without a mood to borrow colours from. */
const BRAND_GRADIENT = ['#BEF264', '#0F766E'] as const;

/** The moods a vibe leans on, in the order they were said; a bass-heavy ask borrows the Bass mood. */
function vibeMoods(q: VibeQuery): MoodId[] {
  const ids = q.moods.filter((m) => MOOD_IDS.includes(m));
  return q.bassHeavy && !ids.includes('bass') ? [...ids, 'bass'] : ids;
}

export function vibeColors(q: VibeQuery): readonly [string, string] {
  const [first, second] = vibeMoods(q);
  if (!first) return BRAND_GRADIENT;
  return [moodById(first).color, moodById(second ?? first).color2];
}

export function vibeIcon(q: VibeQuery): IconName {
  const [first] = vibeMoods(q);
  return first ? MOOD_ICONS[first] : 'magic-wand';
}

function moodTracks(ctx: VibeContext, mood: MoodId): string[] {
  const found = moodMixes(ctx, MOOD_MIX_SIZE).find((m) => m.mood.id === mood);
  if (found) return found.trackIds;
  // Too few strong matches for a Home tile; still give the page the closest songs.
  const m = moodById(mood);
  return ctx.lib.tracks
    .map((t) => ({ id: t.id, score: moodScore(m, t, ctx.features.get(t.id)) }))
    .filter((r) => r.score >= 0.4)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    .slice(0, MOOD_MIX_SIZE)
    .map((r) => r.id);
}

/** The songs in a list mix. Needs no audio features, so screens can show these without the vibe context. */
export function listMixTracks(id: ListMixId, lib: Library, stats: Map<string, TrackStat>, plays: PlayEvent[], now: number): string[] {
  switch (id) {
    case 'on-repeat':
      return onRepeat(stats, plays, now, 30);
    case 'rediscover':
      return rediscover(stats, now, 30);
    case 'recently-added':
      return recentlyAdded(lib, 50);
    case 'recently-played':
      return recentlyPlayed(plays, 50);
  }
}

const isListMix = (id: string): id is ListMixId => (MADE_FOR_YOU as readonly string[]).includes(id);

function listMix(id: ListMixId, trackIds: string[]): Mix {
  const { title, blurb, emptyHint } = MIX_INFO[id];
  return {
    id,
    kicker: 'Made for you',
    title,
    subtitle: trackIds.length ? `${blurb} \u00b7 ${formatCount(trackIds.length, 'song')}` : blurb,
    trackIds,
    source: { kind: 'mix', id, label: title },
    art: { kind: 'mosaic', trackIds, seed: `mix-${id}`, label: title },
    emptyHint,
  };
}

/** Resolves a /mix/<id> route; null for ids that don't name a mix (or a vanished seed track). */
export function resolveMix(id: string, ctx: VibeContext, plays: PlayEvent[]): Mix | null {
  if (id === 'daylist') {
    const d = buildDaylist(ctx, plays, new Date(ctx.now));
    const a = moodById(d.moods[0] ?? 'chill');
    const b = moodById(d.moods[1] ?? d.moods[0] ?? 'chill');
    const night = d.daypart.id === 'night' || d.daypart.id === 'latenight';
    return {
      id,
      kicker: `Daylist \u00b7 ${d.daypart.label}`,
      title: d.title,
      subtitle: d.subtitle,
      trackIds: d.trackIds,
      source: { kind: 'daylist', label: d.title },
      art: { kind: 'gradient', colors: [a.color, b.color2], icon: night ? 'moon' : 'sun-horizon' },
      emptyHint: 'Your daylist fills in once Thrum has found some music.',
    };
  }
  if (id.startsWith('mood-')) {
    const moodId = id.slice(5) as MoodId;
    if (!MOOD_IDS.includes(moodId)) return null;
    const mood = moodById(moodId);
    const trackIds = moodTracks(ctx, moodId);
    return {
      id,
      kicker: 'Mood',
      title: mood.label,
      subtitle: trackIds.length ? `${mood.blurb} \u00b7 ${formatCount(trackIds.length, 'song')}` : mood.blurb,
      trackIds,
      source: { kind: 'mood', id: moodId, label: `${mood.label} mix` },
      art: { kind: 'gradient', colors: [mood.color, mood.color2], icon: MOOD_ICONS[moodId] },
      emptyHint: 'Nothing in your library fits this mood yet. Thrum gets sharper as it finishes listening to your songs.',
    };
  }
  if (id.startsWith('similar-')) {
    const seedId = id.slice(8);
    const seed = ctx.lib.byId.get(seedId);
    if (!seed) return null;
    const trackIds = [seedId, ...similarTracks(seedId, ctx, 49).map((r) => r.id)];
    return {
      id,
      kicker: 'Sounds like',
      title: `More like ${seed.title}`,
      subtitle: `Starts with ${seed.title} \u00b7 ${seed.artist}`,
      trackIds,
      source: { kind: 'similar', id: seedId, label: `Like ${seed.title}` },
      art: { kind: 'cover', albumId: seed.albumId, trackId: seed.id, label: seed.album },
      emptyHint: 'No close matches yet.',
    };
  }
  if (id.startsWith('vibe-')) {
    const query = id.slice(5).trim();
    const q = parseVibe(query, new Date(ctx.now), ctx.lib);
    if (!q.chips.length) return null;
    const trackIds = rankByVibe(q, ctx).map((r) => r.id);
    const title = describeVibe(q);
    const said = `\u201c${query}\u201d`;
    return {
      id,
      kicker: 'Vibe',
      title,
      subtitle: trackIds.length ? `${said} \u00b7 ${formatCount(trackIds.length, 'song')}` : said,
      trackIds,
      source: { kind: 'vibe', id: query, label: title },
      art: { kind: 'gradient', colors: vibeColors(q), icon: vibeIcon(q) },
      emptyHint: 'Nothing fits this vibe yet. Try fewer words, or give Thrum time to finish listening to your songs.',
    };
  }
  // ctx.now is floored to the hour; count to the end of it so this hour's plays are in.
  return isListMix(id) ? listMix(id, listMixTracks(id, ctx.lib, ctx.stats, plays, ctx.now + HOUR_MS - 1)) : null;
}

export function useMix(id: string): Mix | null {
  const ctx = useVibeContext();
  const plays = useHistory((s) => s.plays);
  return useMemo(() => resolveMix(id, ctx, plays), [id, ctx, plays]);
}
