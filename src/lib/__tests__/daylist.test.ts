import { buildDaylist, daypart, moodMixes } from '../daylist';
import { HOUR_MS } from '../time';
import type { Features } from '../types';
import { ctxOf, feat, libOf, play, sample } from './fixtures';

describe('daypart', () => {
  it('splits the day into six parts', () => {
    const parts = Array.from({ length: 24 }, (_, h) => daypart(new Date(2025, 2, 14, h, 30)).id);
    expect(parts).toEqual([
      ...Array(5).fill('latenight'),
      ...Array(3).fill('dawn'),
      ...Array(4).fill('morning'),
      ...Array(5).fill('afternoon'),
      ...Array(4).fill('evening'),
      ...Array(3).fill('night'),
    ]);
  });
});

describe('buildDaylist without history', () => {
  const happy = feat({ energy: 0.8, valence: 0.85, bpm: 124, danceability: 0.75, bass: 0.6, acousticness: 0.1 });
  const blue = feat({ energy: 0.2, valence: 0.15, bpm: 70, danceability: 0.25, bass: 0.3, acousticness: 0.7 });
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `Song ${i}`, artist: `Artist ${i}` }));
  const features: Record<string, Features> = Object.fromEntries(rows.map((r, i) => [r.id, i < 6 ? happy : blue]));
  const ctx = ctxOf(libOf(rows), { features });

  it('uses daypart defaults and a lowercase spotify-style title', () => {
    const d = buildDaylist(ctx, [], new Date(2025, 2, 14, 9), 6);
    expect(d.daypart.id).toBe('morning');
    expect(d.moods).toEqual(['happy', 'energetic']);
    expect(d.title).toBe('friday morning feel-good warm-up');
    expect(d.subtitle).toBe('Made for your morning · 6 songs');
    expect(d.trackIds.filter((id) => Number(id.slice(1)) < 6).length).toBeGreaterThanOrEqual(5);
  });

  it('picks other moods for other dayparts', () => {
    expect(buildDaylist(ctx, [], new Date(2025, 2, 14, 6)).moods).toEqual(['acoustic', 'chill']);
    expect(buildDaylist(ctx, [], new Date(2025, 2, 14, 14)).moods).toEqual(['focus', 'chill']);
    expect(buildDaylist(ctx, [], new Date(2025, 2, 14, 2)).title.startsWith('friday late night')).toBe(true);
  });

  it('copes with tiny and empty libraries', () => {
    const tiny = ctxOf(libOf(rows.slice(0, 3)));
    const d = buildDaylist(tiny, [], new Date(2025, 2, 14, 19));
    expect(d.trackIds).toHaveLength(3);
    expect(d.subtitle).toBe('Made for your evening · 3 songs');
    const empty = buildDaylist(ctxOf(libOf([])), [], new Date(2025, 2, 14, 19));
    expect(empty.trackIds).toEqual([]);
    expect(empty.title.length).toBeGreaterThan(0);
  });
});

describe('buildDaylist with a rich history', () => {
  const s = sample();
  const at = (h: number, m = 15, dayOffset = 0) => new Date(2025, 10, 14 + dayOffset, h, m);
  const artistOf = (id: string) => s.lib.byId.get(id)?.artists[0] ?? id;

  it('learns a title from what is played around this hour', () => {
    const d = buildDaylist(s.ctx, s.plays, at(21));
    expect(d.title).toBe(d.title.toLowerCase());
    expect(d.title.startsWith('friday night ')).toBe(true);
    expect(d.trackIds).toHaveLength(40);
    expect(new Set(d.trackIds).size).toBe(40);
    expect(d.subtitle).toBe('Made for your night · 40 songs');
  });

  it('is stable within a daypart and changes across dayparts and days', () => {
    const night = buildDaylist(s.ctx, s.plays, at(21));
    expect(buildDaylist(s.ctx, s.plays, at(23, 40))).toEqual(night);
    const morning = buildDaylist(s.ctx, s.plays, at(10));
    expect(morning.title.startsWith('friday morning')).toBe(true);
    expect(morning.trackIds).not.toEqual(night.trackIds);
    expect(buildDaylist(s.ctx, s.plays, at(21, 15, 1)).trackIds).not.toEqual(night.trackIds);
  });

  it('spreads artists out', () => {
    const { trackIds } = buildDaylist(s.ctx, s.plays, at(21));
    const counts = new Map<string, number>();
    for (const id of trackIds) counts.set(artistOf(id), (counts.get(artistOf(id)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(4);
    for (let i = 1; i < trackIds.length; i++) expect(artistOf(trackIds[i])).not.toBe(artistOf(trackIds[i - 1]));
  });

  it('skips tracks heard in the last few hours', () => {
    const first = buildDaylist(s.ctx, s.plays, at(21)).trackIds[0];
    const start = new Date(2025, 10, 14, 21).getTime();
    const plays = [...s.plays, play(first, start - HOUR_MS)];
    expect(buildDaylist(s.ctx, plays, at(21)).trackIds).not.toContain(first);
  });
});

describe('moodMixes', () => {
  it('builds one strong mix per mood with enough tracks', () => {
    const mixes = moodMixes(sample().ctx);
    expect(mixes.length).toBeGreaterThanOrEqual(8);
    expect(new Set(mixes.map((m) => m.mood.id)).size).toBe(mixes.length);
    for (const m of mixes) {
      expect(m.trackIds.length).toBeGreaterThanOrEqual(8);
      expect(m.trackIds.length).toBeLessThanOrEqual(30);
      expect(new Set(m.trackIds).size).toBe(m.trackIds.length);
    }
    expect(moodMixes(sample().ctx, 10).every((m) => m.trackIds.length <= 10)).toBe(true);
  });

  it('skips moods without enough good tracks', () => {
    expect(moodMixes(ctxOf(libOf([{ id: 'x' }, { id: 'y' }])))).toEqual([]);
  });
});
