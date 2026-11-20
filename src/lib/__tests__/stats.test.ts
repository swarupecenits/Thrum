import {
  buildTrackStats,
  computeStats,
  isSkip,
  onRepeat,
  personaFor,
  recentlyAdded,
  recentlyPlayed,
  rediscover,
  updateTrackStat,
} from '../stats';
import { DAY_MS } from '../time';
import { libOf, local, play } from './fixtures';

describe('isSkip', () => {
  it('uses 30 s and half the track, a quarter for long tracks', () => {
    expect(isSkip(10_000, 200_000)).toBe(true);
    expect(isSkip(29_000, 200_000)).toBe(true);
    expect(isSkip(31_000, 200_000)).toBe(false);
    expect(isSkip(20_000, 35_000)).toBe(false);
    expect(isSkip(0, 200_000)).toBe(true);
    expect(isSkip(20_000, 0)).toBe(true);
    expect(isSkip(40_000, 0)).toBe(false);
    expect(isSkip(60_000, 12 * 60_000)).toBe(true);
    expect(isSkip(4 * 60_000, 12 * 60_000)).toBe(false);
  });
});

describe('updateTrackStat', () => {
  it('counts plays and skips separately', () => {
    const t0 = local(2025, 3, 1, 20);
    let s = updateTrackStat(undefined, play('a', t0));
    expect(s).toEqual({ trackId: 'a', plays: 1, skips: 0, totalMs: 190_000, firstPlayedAt: t0, lastPlayedAt: t0 });
    s = updateTrackStat(s, play('a', t0 + DAY_MS, { playedMs: 5000, completed: false }));
    expect(s).toMatchObject({ plays: 1, skips: 1, totalMs: 195_000, lastPlayedAt: t0 });
    s = updateTrackStat(s, play('a', t0 - DAY_MS));
    expect(s).toMatchObject({ plays: 2, firstPlayedAt: t0 - DAY_MS, lastPlayedAt: t0 });
    expect(updateTrackStat(undefined, play('a', t0, { skipped: true }))).toMatchObject({ plays: 0, skips: 1, lastPlayedAt: null });
  });
});

describe('computeStats', () => {
  const lib = libOf([
    { id: 'k', title: 'Kesariya', artist: 'Arijit Singh', album: 'Brahmastra', genre: 'Bollywood' },
    { id: 'b', title: 'Brown Munde', artist: 'AP Dhillon, Gurinder Gill & Shinda Kahlon', album: 'Brown Munde', genre: 'Punjabi' },
    { id: 'e', title: 'Excuses', artist: 'AP Dhillon feat. Gurinder Gill', album: 'Excuses', genre: 'Punjabi' },
    { id: 'l', title: 'Baarishein', artist: 'Anuv Jain', album: 'Baarishein', genre: '' },
  ]);
  // Saturday 15 March 2025, 23:30 local.
  const now = local(2025, 3, 15, 23, 30);
  const plays = [
    play('k', local(2025, 3, 13, 22)),
    play('b', local(2025, 3, 13, 23)),
    play('k', local(2025, 3, 14, 22)),
    play('e', local(2025, 3, 14, 23)),
    play('k', local(2025, 3, 15, 22)),
    play('b', local(2025, 3, 15, 23)),
    // A skip-only day doesn't extend the streak.
    play('l', local(2025, 3, 12, 21), { playedMs: 4000, completed: false }),
    ...[1, 2, 3, 4, 5].map((d) => play('l', local(2025, 3, d, 1))),
    play('k', now + 10 * DAY_MS),
  ];

  it('summarises the week', () => {
    const s = computeStats(plays, lib, 'week', now);
    expect(s).toMatchObject({ range: 'week', plays: 6, skips: 1, uniqueTracks: 3, minutes: 19 });
    expect(s.topTracks[0]).toEqual({ id: 'k', label: 'Kesariya', plays: 3, ms: 570_000 });
    expect(s.topAlbums.map((a) => a.label)).toEqual(['Brahmastra', 'Brown Munde', 'Excuses']);
    expect(s.topGenres.map((g) => [g.label, g.plays])).toEqual([['Bollywood', 3], ['Punjabi', 3]]);
    expect(s.clock[22]).toBe(3);
    expect(s.clock[23]).toBe(3);
    expect(s.clock.reduce((a, b) => a + b, 0)).toBe(6);
    expect(s.weekdays).toEqual([0, 0, 0, 2, 2, 2, 0]);
    expect(s.persona).toBe('Just getting started');
  });

  it('credits every artist on a track, features included', () => {
    const s = computeStats(plays, lib, 'week', now);
    expect(s.topArtists.map((a) => [a.label, a.plays])).toEqual([
      ['AP Dhillon', 3],
      ['Arijit Singh', 3],
      ['Gurinder Gill', 3],
      ['Shinda Kahlon', 2],
    ]);
  });

  it('widens with the range and tracks streaks across days', () => {
    expect(computeStats(plays, lib, 'month', now).plays).toBe(11);
    const all = computeStats(plays, lib, 'all', now);
    expect(all.plays).toBe(11);
    expect(all.persona).toBe('Night owl');
    expect(all.streakDays).toBe(3);
    expect(all.longestStreak).toBe(5);
    expect(computeStats(plays, lib, 'week', local(2025, 3, 16, 12)).streakDays).toBe(3);
    expect(computeStats(plays, lib, 'week', local(2025, 3, 17, 12)).streakDays).toBe(0);
  });

  it('handles an empty history', () => {
    const s = computeStats([], lib, 'all', now);
    expect(s).toMatchObject({ plays: 0, skips: 0, minutes: 0, uniqueTracks: 0, streakDays: 0, longestStreak: 0 });
    expect(s.topTracks).toEqual([]);
    expect(s.clock).toHaveLength(24);
    expect(s.weekdays).toHaveLength(7);
  });
});

describe('personaFor', () => {
  const clock = (byHour: Record<number, number>, base = 0) => Array.from({ length: 24 }, (_, h) => byHour[h] ?? base);

  it('names the listener after their busiest part of the day', () => {
    expect(personaFor(clock({ 23: 10, 0: 8, 1: 4 }, 1))).toBe('Night owl');
    expect(personaFor(clock({ 6: 12, 7: 10 }, 1))).toBe('Early bird');
    expect(personaFor(clock({ 12: 9, 13: 8 }, 1))).toBe('Lunchtime looper');
    expect(personaFor(clock({ 18: 14, 19: 12 }, 1))).toBe('Evening regular');
    expect(personaFor(clock({}, 2))).toBe('All-day listener');
    expect(personaFor(clock({ 23: 9 }))).toBe('Just getting started');
  });
});

describe('collections', () => {
  const now = local(2025, 3, 15, 12);
  const days = (n: number) => now - n * DAY_MS;
  const plays = [
    play('a', days(1)),
    play('a', days(3)),
    play('a', days(9)),
    play('b', days(2)),
    play('b', days(4)),
    play('c', days(1)),
    play('e', days(2)),
    play('e', days(3), { skipped: true }),
    ...[50, 51, 52, 53, 54].map((d) => play('d', days(d))),
    ...[100, 101, 102].map((d) => play('f', days(d))),
    ...[100, 101].map((d) => play('g', days(d))),
  ];
  const stats = buildTrackStats(plays);

  it('finds what is on repeat and what deserves a rediscovery', () => {
    expect(onRepeat(stats, plays, now)).toEqual(['a', 'b']);
    expect(onRepeat(stats, plays, now, 1)).toEqual(['a']);
    expect(rediscover(stats, now)).toEqual(['d', 'f']);
    expect(rediscover(stats, days(49))).toEqual(['f']);
  });

  it('lists recently played without repeats or skips', () => {
    const extra = [...plays, play('z', days(0.5), { playedMs: 3000, completed: false })];
    expect(recentlyPlayed(extra).slice(0, 4)).toEqual(['a', 'c', 'b', 'e']);
    expect(recentlyPlayed(extra, 2)).toEqual(['a', 'c']);
    expect(recentlyPlayed([])).toEqual([]);
  });

  it('lists recently added tracks newest first', () => {
    const lib = libOf([
      { id: 'old', dateAdded: Date.UTC(2023, 0, 1) },
      { id: 'new', dateAdded: Date.UTC(2025, 2, 1) },
      { id: 'mid', dateAdded: Date.UTC(2024, 5, 1) },
    ]);
    expect(recentlyAdded(lib)).toEqual(['new', 'mid', 'old']);
    expect(recentlyAdded(lib, 1)).toEqual(['new']);
  });
});
