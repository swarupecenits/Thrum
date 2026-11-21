import { describeVibe, estimatePoint, parseVibe, rankByPoint, rankByVibe, VIBE_EXAMPLES, vibeTitle, withoutChip } from '../vibe';
import { DAY_MS } from '../time';
import type { Features, PlayEvent, VibeQuery } from '../types';
import { ctxOf, feat, libOf, local, play, sample } from './fixtures';

const NOW = new Date(2025, 2, 15, 20);
const parse = (s: string) => parseVibe(s, NOW);
const labels = (q: VibeQuery) => q.chips.map((c) => c.label);

describe('parseVibe', () => {
  it('chill late night bass heavy 90s hindi', () => {
    const q = parse('chill late night bass heavy 90s hindi');
    expect(q.moods).toEqual(['chill', 'latenight']);
    expect(q.bassHeavy).toBe(true);
    expect(q.era).toEqual([1990, 1999]);
    expect(q.genres).toEqual(['bollywood']);
    expect(q.text).toBe('');
    expect(labels(q)).toEqual(['Chill', 'Late night', 'Bass-heavy', '1990s', 'Bollywood']);
    expect(describeVibe(q)).toBe('Chill · Late night · Bass-heavy · 1990s · Bollywood');
  });

  it('upbeat songs for workout', () => {
    const q = parse('upbeat songs for workout');
    expect(q.moods).toContain('workout');
    expect(q.energy?.[0]).toBeGreaterThanOrEqual(0.6);
    expect(q.energy?.[1]).toBe(1);
    expect(q.text).toBe('');
  });

  it('sad slow songs / fast punjabi', () => {
    const sad = parse('sad slow songs');
    expect(sad.moods).toEqual(['sad']);
    expect(sad.bpm).toEqual([0, 95]);
    const fast = parse('fast punjabi');
    expect(fast.genres).toEqual(['punjabi']);
    expect(fast.bpm?.[0]).toBeGreaterThanOrEqual(120);
    expect(labels(fast)).toEqual(['Fast', 'Punjabi']);
  });

  it('songs like tum hi ho', () => {
    const { lib } = sample();
    const q = parseVibe('songs like tum hi ho', NOW, lib);
    expect(q.similarTo).toBe('1001');
    expect(labels(q)).toEqual(['Like: Tum Hi Ho']);
    expect(q.text).toBe('');
    expect(parse('songs like tum hi ho').similarTo).toBeNull();
  });

  it('personal filters', () => {
    const top = parse('most played arijit');
    expect(top.personal).toEqual(['most-played']);
    expect(top.text).toBe('arijit');
    expect(labels(top)).toEqual(['Most played', 'arijit']);
    expect(parse("stuff I haven't heard in a while")).toMatchObject({ personal: ['forgotten'], text: '' });
    expect(parse('stuff i haven’t heard in a while').personal).toEqual(['forgotten']);
    expect(parse('new').personal).toEqual(['new']);
    expect(parse('recently added')).toMatchObject({ personal: ['new'], chips: [expect.objectContaining({ label: 'Recently added' })] });
    for (const w of ['favourites', 'favorites', 'liked']) expect(parse(w).personal).toEqual(['favorites']);
    expect(parse('never played').personal).toEqual(['never-played']);
    expect(parse('recently played').personal).toEqual(['recent']);
  });

  it('durations', () => {
    const q = parse('under 3 minutes');
    expect(q.durationMs).toEqual([0, 180_000]);
    expect(labels(q)).toEqual(['Under 3 min']);
    expect(parse('over 6 min').durationMs?.[0]).toBe(360_000);
    expect(parse('under 3:30').durationMs).toEqual([0, 210_000]);
  });

  it('eras', () => {
    expect(parse('2010s')).toMatchObject({ era: [2010, 2019], text: '' });
    expect(labels(parse('2010s'))).toEqual(['2010s']);
    expect(parse('before 2000').era).toEqual([1900, 1999]);
    expect(parse('from 2005').era).toEqual([2005, 2025]);
    expect(parse('old songs').era?.[1]).toBe(1999);
    expect(parse('the 80s').era).toEqual([1980, 1989]);
    expect(parse('between 2005 and 2010').era).toEqual([2005, 2010]);
    expect(parse('90s and 2000s').era).toEqual([1990, 2009]);
  });

  it('moods, genres and sound words', () => {
    expect(parse('focus lofi')).toMatchObject({ moods: ['focus'], genres: ['lofi'], text: '' });
    expect(parse('romantic bengali')).toMatchObject({ moods: ['romantic'], genres: ['bengali'], text: '' });
    const unplugged = parse('acoustic unplugged');
    expect(unplugged.moods).toContain('acoustic');
    expect(unplugged.text).toBe('');
    expect(parse('loud').energy?.[0]).toBeGreaterThanOrEqual(0.6);
    expect(parse('soft').energy?.[1]).toBeLessThanOrEqual(0.4);
    expect(parse('quiet').energy?.[1]).toBeLessThanOrEqual(0.4);
    expect(parse('happy').moods).toEqual(['happy']);
    expect(parse('dark').valence?.[1]).toBeLessThanOrEqual(0.4);
    for (const w of ['bass', 'bassy', '808']) expect(parse(w)).toMatchObject({ bassHeavy: true, text: '' });
    expect(parse('pyaar wale gaane').moods).toEqual(['romantic']);
    expect(parse('bhangra')).toMatchObject({ moods: ['party'], genres: ['punjabi'] });
  });

  it('drops stop words and keeps unknown words as text', () => {
    expect(parse('play me some songs with vibes')).toMatchObject({ text: '', chips: [] });
    const q = parse('I want something chill by prateek kuhad');
    expect(q.moods).toEqual(['chill']);
    expect(q.text).toBe('prateek kuhad');
    expect(labels(q)).toEqual(['Chill', 'prateek kuhad']);
    expect(describeVibe(q)).toBe('Chill · “prateek kuhad”');
    expect(parse('')).toMatchObject({ text: '', moods: [], chips: [] });
  });

  it('suggests examples that parse completely', () => {
    for (const s of VIBE_EXAMPLES) {
      const q = parse(s);
      expect({ s, text: q.text }).toEqual({ s, text: '' });
      expect(q.chips.length).toBeGreaterThan(0);
    }
  });
});

describe('vibeTitle', () => {
  it('wraps between parts: short named parts stay whole and each dot stays with the part before it', () => {
    const nb = (s: string) => s.replace(/_/g, '\u00a0');
    const q = parse('chill late night recently added under 4 minutes prateek kuhad');
    expect(describeVibe(q)).toBe('Chill · Late night · Recently added · Under 4 min · “prateek kuhad”');
    expect(vibeTitle(q)).toBe(nb('Chill_· Late_night_· Recently added_· Under_4_min_· “prateek kuhad”'));
  });
});

describe('withoutChip', () => {
  const drop = (s: string, label: string) => {
    const chip = parse(s).chips.find((c) => c.label === label);
    if (!chip) throw new Error(`no "${label}" chip in "${s}"`);
    return withoutChip(s, chip, NOW);
  };

  it('takes one chip out of the query', () => {
    expect(drop('chill late night bass heavy', 'Late night')).toBe('chill bass heavy');
    expect(drop('sad songs from the 90s', '1990s')).toBe('sad songs from');
    expect(drop('focus music under 3:30', 'Under 3:30')).toBe('focus music');
    expect(drop('stuff i haven’t heard in a while', 'Rediscover')).toBe('stuff i');
  });

  it('removes scattered leftover words', () => {
    expect(drop('prateek chill kuhad', 'prateek kuhad')).toBe('chill');
  });

  it('cuts whole words and repeated ideas', () => {
    expect(drop('sadhguru sad', 'Sad')).toBe('sadhguru');
    expect(drop('bassline bass', 'Bass-heavy')).toBe('');
    expect(drop('bass 2010s bassy', 'Bass-heavy')).toBe('2010s');
  });
});

describe('rankByVibe', () => {
  const now = local(2025, 3, 15, 20);
  const lib = libOf([
    { id: 'tum', title: 'Tum Hi Ho', artist: 'Arijit Singh', genre: 'Bollywood', year: 2013, durationMs: 262_000 },
    { id: 'kes', title: 'Kesariya', artist: 'Arijit Singh', genre: 'Bollywood', year: 2022, durationMs: 268_000 },
    { id: 'brown', title: 'Brown Munde', artist: 'AP Dhillon', genre: 'Punjabi', year: 2020, durationMs: 267_000 },
    { id: 'lover', title: 'Lover', artist: 'Diljit Dosanjh', genre: 'Punjabi', year: 2021, durationMs: 188_000 },
    { id: 'dilse', title: 'Dil Se Re', artist: 'A.R. Rahman', genre: 'Bollywood', year: 1998, durationMs: 410_000 },
    { id: 'tujhe', title: 'Tujhe Dekha To', artist: 'Kumar Sanu & Lata Mangeshkar', genre: 'Bollywood', year: 1995, durationMs: 300_000 },
    { id: 'blind', title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Pop', year: 2019, durationMs: 200_000, dateAdded: now - 20 * DAY_MS },
    { id: 'lofi', title: 'Kesariya (Lofi Flip)', artist: 'Arijit Singh x Lofi Chai', genre: 'Lo-Fi', year: 2022, durationMs: 170_000 },
    { id: 'amar', title: 'Amake Amar Moto Thakte Dao', artist: 'Anupam Roy', genre: 'Bengali', year: 2015, durationMs: 290_000 },
    { id: 'unk', title: 'Track 07', artist: '<unknown>', genre: '', year: 0, durationMs: 150_000, dateAdded: now - 5 * DAY_MS },
  ]);
  const features: Record<string, Features> = {
    tum: feat({ energy: 0.35, valence: 0.2, bpm: 94, bass: 0.4, acousticness: 0.5, danceability: 0.35, key: 9, mode: 0 }),
    kes: feat({ energy: 0.45, valence: 0.5, bpm: 94, bass: 0.45, acousticness: 0.4, key: 9, mode: 0 }),
    brown: feat({ energy: 0.82, valence: 0.65, bpm: 168, bass: 0.88, danceability: 0.8, acousticness: 0.05 }),
    lover: feat({ energy: 0.75, valence: 0.8, bpm: 130, bass: 0.7, danceability: 0.8, acousticness: 0.1 }),
    dilse: feat({ energy: 0.7, valence: 0.45, bpm: 120, bass: 0.5 }),
    blind: feat({ energy: 0.8, valence: 0.6, bpm: 171, bass: 0.6, danceability: 0.75, acousticness: 0.05 }),
    lofi: feat({ energy: 0.22, valence: 0.45, bpm: 80, bass: 0.5, acousticness: 0.45, danceability: 0.5 }),
    amar: feat({ energy: 0.3, valence: 0.5, bpm: 90, bass: 0.3, acousticness: 0.75 }),
  };
  const times = (id: string, n: number, lastDaysAgo: number): PlayEvent[] =>
    Array.from({ length: n }, (_, i) => play(id, now - (lastDaysAgo + i) * DAY_MS));
  const plays = [...times('tum', 12, 2), ...times('kes', 5, 1), ...times('brown', 4, 90), ...times('dilse', 2, 100), ...times('lover', 1, 10)];
  const ctx = ctxOf(lib, { features, plays, favorites: ['kes', 'amar'], now });
  const rank = (s: string) => rankByVibe(parseVibe(s, new Date(now), lib), ctx).map((r) => r.id);

  it('filters by era, keeping unknown years last', () => {
    expect(rank('90s')).toEqual(['dilse', 'tujhe', 'unk']);
  });

  it('filters by genre family', () => {
    expect(rank('punjabi')).toEqual(['brown', 'lover', 'unk']);
    expect(rank('bengali')).toEqual(['amar', 'unk']);
  });

  it('applies personal filters', () => {
    expect(rank('favourites')).toEqual(['kes', 'amar']);
    expect(rank('recently added')).toEqual(['unk', 'blind']);
    expect(rank("stuff I haven't heard in a while")).toEqual(['brown']);
    expect(rank('never played').sort()).toEqual(['amar', 'blind', 'lofi', 'tujhe', 'unk']);
    expect(rank('recently played').sort()).toEqual(['kes', 'tum']);
  });

  it('applies duration filters and requires text matches', () => {
    expect(rank('under 3 minutes')).toEqual(['lofi', 'unk']);
    expect(rank('most played arijit')).toEqual(['tum', 'kes']);
    expect(rank('arjit').sort()).toEqual(['kes', 'lofi', 'tum']);
    expect(rank('zzzz')).toEqual([]);
  });

  it('scores moods, tempo and bass', () => {
    expect(rank('bass heavy punjabi')[0]).toBe('brown');
    expect(rank('fast').slice(0, 3).sort()).toEqual(['blind', 'brown', 'lover']);
    expect(rank('sad')[0]).toBe('tum');
    expect(rank('chill lofi')[0]).toBe('lofi');
  });

  it('finds sound-alikes without the seed itself', () => {
    const q = parseVibe('songs like tum hi ho', new Date(now), lib);
    expect(q.similarTo).toBe('tum');
    const ids = rankByVibe(q, ctx).map((r) => r.id);
    expect(ids).not.toContain('tum');
    expect(ids[0]).toBe('kes');
  });

  it('is deterministic and empty without constraints', () => {
    expect(rank('chill late night')).toEqual(rank('chill late night'));
    expect(rank('play some songs')).toEqual([]);
    const scored = rankByVibe(parseVibe('romantic', new Date(now)), ctx);
    for (const r of scored) expect(r.score).toBeGreaterThan(0);
    expect(rankByVibe(parseVibe('romantic', new Date(now)), ctx, 2)).toHaveLength(2);
  });
});

describe('Mood Map', () => {
  const lib = libOf([
    { id: 'hype', title: 'Hype', artist: 'A', genre: 'Punjabi' },
    { id: 'calm', title: 'Calm', artist: 'B', genre: 'Lo-Fi' },
    { id: 'happy', title: 'Happy', artist: 'C' },
    { id: 'blue', title: 'Blue', artist: 'D' },
  ]);
  const ctx = ctxOf(lib, {
    features: { happy: feat({ energy: 0.85, valence: 0.9 }), blue: feat({ energy: 0.2, valence: 0.1 }) },
  });

  it('ranks by distance to the touched point', () => {
    expect(rankByPoint(ctx, 0.9, 0.9)[0].id).toBe('happy');
    expect(rankByPoint(ctx, 0.1, 0.1)[0].id).toBe('blue');
    expect(rankByPoint(ctx, 0.5, 0.5, 2)).toHaveLength(2);
    expect(rankByPoint(ctx, Number.NaN, 2).length).toBe(4);
  });

  it('estimates points from features or genre priors', () => {
    const t = (id: string) => lib.byId.get(id) ?? lib.tracks[0];
    expect(estimatePoint(t('happy'), ctx.features.get('happy'))).toEqual({ energy: 0.85, valence: 0.9 });
    const hype = estimatePoint(t('hype'), undefined);
    const calm = estimatePoint(t('calm'), undefined);
    expect(hype.energy).toBeGreaterThan(calm.energy);
    expect(estimatePoint(t('hype'), undefined)).toEqual(hype);
    for (const p of [hype, calm]) {
      expect(p.energy).toBeGreaterThanOrEqual(0);
      expect(p.valence).toBeLessThanOrEqual(1);
    }
  });
});
