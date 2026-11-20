import { buildLibrary } from '../library';
import { genreFamily } from '../moods';
import { SAMPLE_NOW, sampleLibrary } from '../sample-library';
import { computeStats } from '../stats';
import { DAY_MS } from '../time';
import type { Features, Track } from '../types';

describe('sampleLibrary', () => {
  const s = sampleLibrary();
  const lib = buildLibrary(s.raw);
  const featureOf = (t: Track): Features | undefined => s.features[t.id];

  it('is deterministic', () => {
    expect(sampleLibrary()).toEqual(s);
  });

  it('builds into a sane library', () => {
    expect(lib.tracks.length).toBeGreaterThanOrEqual(85);
    expect(lib.tracks.length).toBeLessThanOrEqual(100);
    expect(lib.albums.length).toBeGreaterThanOrEqual(15);
    expect(lib.artists.length).toBeGreaterThan(40);
    expect(new Set(lib.tracks.map((t) => t.id)).size).toBe(lib.tracks.length);
    expect(lib.totalDurationMs).toBe(lib.tracks.reduce((a, t) => a + t.durationMs, 0));
    for (const t of lib.tracks) {
      expect(t.title.trim()).not.toBe('');
      expect(t.title).not.toMatch(/pagalworld|mr-jatt|djmaza|mp3mad|\.mp3$/i);
      if (t.year !== null) {
        expect(t.year).toBeGreaterThanOrEqual(1994);
        expect(t.year).toBeLessThanOrEqual(2025);
      }
      expect(t.dateAdded).toBeLessThanOrEqual(SAMPLE_NOW);
      expect(t.dateAdded).toBeGreaterThan(SAMPLE_NOW - 2 * 366 * DAY_MS);
    }
    const titles = lib.tracks.map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(['Kesariya', 'Tum Hi Ho', 'Brown Munde']));
    expect(titles.some((t) => t.startsWith('Gul'))).toBe(true);
    expect(lib.tracks.some((t) => t.artist === 'Unknown artist')).toBe(true);
  });

  it('mixes formats, folders and messy genres like a real phone', () => {
    const mimes = s.raw.map((r) => r.mime);
    expect(new Set(mimes)).toEqual(new Set(['audio/mpeg', 'audio/flac', 'audio/mp4']));
    expect(mimes.filter((m) => m === 'audio/mpeg').length).toBeGreaterThan(mimes.length / 2);
    expect(lib.folders.map((f) => f.id)).toEqual(expect.arrayContaining(['Music/Bollywood/', 'Download/', 'Music/Punjabi/']));
    expect(s.raw.some((r) => r.genre === '')).toBe(true);
    const families = new Set(lib.tracks.map((t) => genreFamily(t.genre)));
    for (const f of ['bollywood', 'punjabi', 'bengali', 'indie', 'lofi', 'hiphop', 'edm', 'pop', 'sufi']) {
      expect(families).toContain(f);
    }
  });

  it('has features for most tracks, consistent with genre', () => {
    const ids = new Set(lib.tracks.map((t) => t.id));
    expect(Object.keys(s.features).every((id) => ids.has(id))).toBe(true);
    expect(Object.keys(s.features).length).toBeGreaterThanOrEqual(0.8 * lib.tracks.length);
    for (const f of Object.values(s.features)) {
      for (const v of [f.energy, f.valence, f.bass, f.danceability, f.acousticness, f.brightness]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(f.bpm).toBeGreaterThanOrEqual(60);
      expect(f.bpm).toBeLessThanOrEqual(200);
    }
    const mean = (family: string, pick: (f: Features) => number) => {
      const fs = lib.tracks.filter((t) => genreFamily(t.genre) === family).flatMap((t) => featureOf(t) ?? []);
      return fs.reduce((a, f) => a + pick(f), 0) / fs.length;
    };
    expect(mean('punjabi', (f) => f.bass)).toBeGreaterThan(mean('lofi', (f) => f.bass) + 0.15);
    expect(mean('hiphop', (f) => f.bass)).toBeGreaterThan(mean('indie', (f) => f.bass));
    expect(mean('lofi', (f) => f.energy)).toBeLessThan(mean('edm', (f) => f.energy) - 0.3);
  });

  it('has a lively, night-leaning play history', () => {
    expect(s.plays.length).toBeGreaterThanOrEqual(400);
    expect(s.plays.length).toBeLessThanOrEqual(800);
    for (const p of s.plays) {
      expect(lib.byId.has(p.trackId)).toBe(true);
      expect(p.startedAt).toBeLessThanOrEqual(SAMPLE_NOW);
      expect(p.startedAt).toBeGreaterThan(SAMPLE_NOW - 91 * DAY_MS);
    }
    const all = computeStats(s.plays, lib, 'all', SAMPLE_NOW);
    expect(all.persona).toBe('Night owl');
    expect(all.topArtists[0].label).toBe('Arijit Singh');
    expect(all.skips).toBeGreaterThan(0);
    const week = computeStats(s.plays, lib, 'week', SAMPLE_NOW);
    expect(week.plays).toBeGreaterThan(20);
    expect(week.streakDays).toBeGreaterThan(3);
  });
});
