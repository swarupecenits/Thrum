import { buildLibrary } from '../library';
import { mulberry32 } from '../random';
import { buildSearchIndex, search } from '../search';
import type { Playlist, RawTrack } from '../types';
import { libOf, raw, sample } from './fixtures';

const playlist = (id: string, name: string): Playlist => ({ id, name, trackIds: [], createdAt: 0, updatedAt: 0 });

describe('search on the sample library', () => {
  const { lib } = sample();
  const index = buildSearchIndex(lib, [playlist('p1', 'Gym Bangers'), playlist('p2', 'Late Night Drives')]);

  it('requires every word of a multi-word query to match the item', () => {
    const r = search(index, 'tum hi ho arijit');
    expect(r.top).toMatchObject({ kind: 'track', id: '1001' });
    expect(r.tracks[0].id).toBe('1001');
    for (const t of r.tracks) expect(t.artists).toContain('Arijit Singh');
    expect(r.artists).toEqual([]);
  });

  it('forgives typos and stylised names', () => {
    expect(search(index, 'arjit').top).toMatchObject({ kind: 'artist', id: 'arijit singh' });
    expect(search(index, 'kr$na').top).toMatchObject({ kind: 'artist', id: 'krsna' });
    expect(search(index, 'krsna').top).toMatchObject({ kind: 'artist', id: 'krsna' });
    expect(search(index, 'weeknd').top).toMatchObject({ kind: 'artist', id: 'the weeknd' });
  });

  it('matches initials, prefixes, genres and playlists', () => {
    expect(search(index, 'ddlj').top).toMatchObject({ kind: 'album', id: '105' });
    expect(search(index, 'kesar').top).toMatchObject({ kind: 'track', id: '1006' });
    expect(search(index, 'punjabi').top).toMatchObject({ kind: 'genre', id: 'punjabi' });
    expect(search(index, 'gym').playlists.map((p) => p.id)).toEqual(['p1']);
    expect(search(index, 'late night').playlists.map((p) => p.id)).toEqual(['p2']);
  });

  it('caps each kind and handles empty or hopeless queries', () => {
    const r = search(index, 'a', 3);
    expect(r.tracks.length).toBeLessThanOrEqual(3);
    expect(r.artists.length).toBeLessThanOrEqual(3);
    expect(search(index, '   ')).toEqual({ query: '   ', top: null, tracks: [], albums: [], artists: [], playlists: [], genres: [] });
    expect(search(index, 'zzqxj').top).toBeNull();
  });
});

describe('search ranking', () => {
  const lib = libOf([
    { id: 't1', title: 'Ilahi', artist: 'Arijit Singh', album: 'Yeh Jawaani Hai Deewani', genre: 'Bollywood' },
    { id: 't2', title: 'Ilahi (Reprise)', artist: 'Mohit Chauhan', album: 'Yeh Jawaani Hai Deewani' },
    { id: 't3', title: 'Kabira', artist: 'Tochi Raina & Rekha Bhardwaj', album: 'Yeh Jawaani Hai Deewani' },
    { id: 't4', title: 'Badtameez Dil', artist: 'Benny Dayal', album: 'Yeh Jawaani Hai Deewani' },
    { id: 't5', title: 'Café Mocha', artist: 'Zoë Rao', album: 'Brews' },
  ]);
  const index = buildSearchIndex(lib, []);

  it('puts exact titles above prefixes and words across fields', () => {
    const r = search(index, 'ilahi');
    expect(r.top).toMatchObject({ kind: 'track', id: 't1' });
    expect(r.tracks.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(search(index, 'deewani kabira').tracks.map((t) => t.id)).toEqual(['t3']);
    expect(search(index, 'kabira rekha').tracks.map((t) => t.id)).toEqual(['t3']);
  });

  it('matches album initials and ignores accents', () => {
    expect(search(index, 'yjhd').top).toMatchObject({ kind: 'album' });
    expect(search(index, 'cafe zoe').tracks.map((t) => t.id)).toEqual(['t5']);
    expect(search(buildSearchIndex(buildLibrary([]), []), 'anything').top).toBeNull();
  });
});

function syntheticLibrary(n: number): { rows: RawTrack[]; words: string[] } {
  const rng = mulberry32(2024);
  const syllables = 'ka ri ya dil se tum ho pya ar ish na ma ra ja ve sa ki lo bha ro shi ni te mu jh ko pa ta ha ye vo bo lu mi zi gu fa de'.split(' ');
  const pick = <T,>(list: T[]): T => list[Math.floor(rng() * list.length)];
  const words = Array.from({ length: 4000 }, () => {
    let w = '';
    for (let i = 0, k = 2 + Math.floor(rng() * 3); i < k; i++) w += pick(syllables);
    return w;
  });
  const phrase = (min: number, max: number) =>
    Array.from({ length: min + Math.floor(rng() * (max - min + 1)) }, () => pick(words)).join(' ');
  const artists = Array.from({ length: 800 }, () => phrase(1, 3));
  const albums = Array.from({ length: 1500 }, () => phrase(1, 3));
  const genres = ['Bollywood', 'Punjabi', 'Hip-Hop/Rap', 'Lo-Fi', 'EDM', 'Pop', 'Rock', 'Indie Pop', 'Sufi', 'Bengali', ''];
  const rows = Array.from({ length: n }, (_, i) => {
    const albumNo = Math.floor(rng() * albums.length);
    return raw({
      id: `s${i}`,
      title: phrase(1, 4),
      artist: rng() < 0.25 ? `${pick(artists)}, ${pick(artists)}` : pick(artists),
      album: albums[albumNo],
      albumId: `al${albumNo}`,
      genre: pick(genres),
    });
  });
  return { rows, words };
}

describe('search performance', () => {
  it('answers 2-8 character queries over 10,000 tracks quickly', () => {
    const { rows, words } = syntheticLibrary(10_000);
    const lib = buildLibrary(rows);
    const index = buildSearchIndex(lib, []);
    const rng = mulberry32(99);
    const queries = Array.from({ length: 60 }, (_, i) => {
      const w = words[Math.floor(rng() * words.length)];
      const q = w.slice(0, 2 + (i % 7));
      return i % 5 === 4 ? `${q} ${words[Math.floor(rng() * words.length)].slice(0, 3)}`.slice(0, 8) : q;
    });
    for (const q of queries.slice(0, 5)) search(index, q);
    const start = Date.now();
    let hits = 0;
    for (const q of queries) hits += search(index, q).tracks.length;
    const avg = (Date.now() - start) / queries.length;
    expect(hits).toBeGreaterThan(0);
    expect(avg).toBeLessThan(60);
  }, 60_000);
});
