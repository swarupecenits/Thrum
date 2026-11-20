import {
  camelot,
  energyLabel,
  harmonicCompatible,
  keyName,
  similarTracks,
  similarity,
  tempoDistance,
  tempoLabel,
} from '../features';
import { mulberry32 } from '../random';
import { ctxOf, feat, libOf, sample } from './fixtures';

describe('keys', () => {
  it('maps keys to the Camelot wheel and names', () => {
    expect(camelot(0, 1)).toBe('8B');
    expect(camelot(9, 0)).toBe('8A');
    expect(camelot(7, 1)).toBe('9B');
    expect(camelot(4, 0)).toBe('9A');
    expect(camelot(6, 0)).toBe('11A');
    expect(camelot(8, 1)).toBe('4B');
    expect(camelot(-1, 0)).toBe('');
    expect(keyName(9, 0)).toBe('A minor');
    expect(keyName(1, 1)).toBe('Db major');
    expect(keyName(-1, 1)).toBe('');
  });

  it('knows which keys mix harmonically', () => {
    const k = (key: number, mode: number) => feat({ key, mode });
    expect(harmonicCompatible(k(0, 1), k(9, 0))).toBe(true); // relative minor
    expect(harmonicCompatible(k(0, 1), k(7, 1))).toBe(true); // 8B -> 9B
    expect(harmonicCompatible(k(0, 1), k(5, 1))).toBe(true); // 8B -> 7B
    expect(harmonicCompatible(k(4, 1), k(11, 1))).toBe(true); // 12B -> 1B wraps
    expect(harmonicCompatible(k(0, 1), k(2, 1))).toBe(false);
    expect(harmonicCompatible(k(-1, 1), k(-1, 1))).toBe(false);
  });
});

describe('similarity', () => {
  const base = feat({ energy: 0.7, valence: 0.6, bass: 0.8, bpm: 140, key: 9, mode: 0 });

  it('is 1 for identical sounds and tolerates half/double time', () => {
    expect(similarity(base, base)).toBe(1);
    expect(tempoDistance(70, 140)).toBe(0);
    expect(similarity(base, { ...base, bpm: 70 })).toBe(1);
    expect(similarity(base, { ...base, bpm: 100 })).toBeLessThan(similarity(base, { ...base, bpm: 136 }));
  });

  it('separates very different tracks and stays within 0..1', () => {
    const opposite = feat({ energy: 0.05, valence: 0.1, bass: 0.1, danceability: 0.1, acousticness: 0.95, bpm: 100, key: 2, mode: 1 });
    expect(similarity(base, opposite)).toBeLessThan(0.3);
    const rng = mulberry32(3);
    for (let i = 0; i < 100; i++) {
      const a = feat({ energy: rng(), valence: rng(), bass: rng(), bpm: 60 + rng() * 120, key: Math.floor(rng() * 12) });
      const s = similarity(a, base);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(similarity(base, a)).toBeCloseTo(s, 10);
    }
  });
});

describe('similarTracks', () => {
  const near = feat({ energy: 0.8, valence: 0.6, bass: 0.85, bpm: 92, danceability: 0.75, acousticness: 0.1, key: 9, mode: 0 });
  const lib = libOf([
    { id: 'seed', title: 'Brown Munde', artist: 'AP Dhillon', album: 'Not By Chance', albumId: 'nbc', genre: 'Punjabi', year: 2020 },
    { id: 'copy', title: 'Brown Munde', artist: 'AP Dhillon', album: 'Punjabi Hits', albumId: 'ph', genre: 'Punjabi', year: 2020 },
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `b${n}`, title: `Bass ${n}`, artist: `Producer ${n}`, album: 'Bass Album', albumId: 'ba', genre: 'Punjabi', year: 2021 })),
    { id: 'o1', title: 'Excuses', artist: 'AP Dhillon', album: 'Hidden Gems', albumId: 'hg', genre: 'Punjabi', year: 2020 },
    { id: 'o2', title: 'Softly', artist: 'Karan Aujla', album: 'Making Memories', albumId: 'mm', genre: 'Punjabi', year: 2023 },
    { id: 'o3', title: 'Kasoor', artist: 'Prateek Kuhad', album: 'Kasoor', albumId: 'ks', genre: 'Indie', year: 2020 },
    { id: 'o4', title: 'Lover', artist: 'Diljit Dosanjh', album: 'MoonChild Era', albumId: 'me', genre: 'Punjabi', year: 2021 },
  ]);
  const features = {
    seed: near,
    copy: near,
    ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`b${n}`, { ...near, energy: 0.8 - n * 0.005 }])),
    o1: { ...near, energy: 0.75, valence: 0.55 },
    o2: { ...near, energy: 0.72, bass: 0.8 },
    o3: feat({ energy: 0.15, valence: 0.3, bass: 0.2, acousticness: 0.9, danceability: 0.2, bpm: 76, key: 2, mode: 1 }),
    o4: { ...near, bpm: 184 },
  };
  const ctx = ctxOf(lib, { features });

  it('never returns the seed or another copy of it', () => {
    const radio = similarTracks('seed', ctx);
    const ids = radio.map((r) => r.id);
    expect(ids).not.toContain('seed');
    expect(ids).not.toContain('copy');
    expect(ids).toHaveLength(9);
    const worst = radio.reduce((a, b) => (b.score < a.score ? b : a));
    expect(worst.id).toBe('o3');
  });

  it('caps tracks per album so the radio stays varied', () => {
    const top = similarTracks('seed', ctx, 5).map((r) => r.id);
    expect(top.filter((id) => id.startsWith('b')).length).toBeLessThanOrEqual(2);
    expect(top).toEqual(expect.arrayContaining(['o1', 'o2', 'o4']));
    expect(similarTracks('missing', ctx)).toEqual([]);
    expect(similarTracks('seed', ctx, 0)).toEqual([]);
  });

  it('falls back to genre family, artist and era without features', () => {
    const plain = libOf([
      { id: 's', title: 'Tum Hi Ho', artist: 'Arijit Singh', genre: 'Bollywood', year: 2013 },
      { id: 'x1', title: 'Levels', artist: 'Avicii', genre: 'EDM', year: 2011 },
      { id: 'x2', title: 'Strobe', artist: 'deadmau5', genre: 'Electronic', year: 2009 },
      { id: 'y1', title: 'Channa Mereya', artist: 'Arijit Singh', genre: 'Bollywood', year: 2016 },
      { id: 'y2', title: 'Kabira', artist: 'Tochi Raina', genre: 'Hindi', year: 2013 },
      { id: 'y3', title: 'Raabta', artist: 'Arijit Singh', genre: '', year: 2012 },
    ]);
    const ids = similarTracks('s', ctxOf(plain)).map((r) => r.id);
    expect(ids.slice(0, 3).sort()).toEqual(['y1', 'y2', 'y3']);
    expect(ids.slice(3).sort()).toEqual(['x1', 'x2']);
  });

  it('keeps sample radio varied', () => {
    const { ctx: sctx, lib: slib } = sample();
    const radio = similarTracks('1001', sctx, 20);
    expect(radio).toHaveLength(20);
    const perArtist = new Map<string, number>();
    for (const r of radio) {
      const a = slib.byId.get(r.id)?.artists[0] ?? '';
      perArtist.set(a, (perArtist.get(a) ?? 0) + 1);
    }
    expect(Math.max(...perArtist.values())).toBeLessThanOrEqual(3);
  });
});

describe('labels', () => {
  it.each([
    [0, ''], [80, 'Slow'], [85, 'Mid-tempo'], [117, 'Mid-tempo'], [118, 'Upbeat'], [139, 'Upbeat'], [140, 'Fast'],
  ])('tempo %s -> %s', (bpm, label) => {
    expect(tempoLabel(bpm)).toBe(label);
  });

  it('labels energy', () => {
    expect([0.1, 0.3, 0.5, 0.7, 0.9].map(energyLabel)).toEqual(['Calm', 'Mellow', 'Balanced', 'Energetic', 'Intense']);
    expect(energyLabel(Number.NaN)).toBe('');
  });
});
