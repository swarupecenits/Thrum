import {
  albumTracks,
  artistAlbums,
  buildLibrary,
  decodeTrackNumber,
  sectionIndex,
  sortAlbums,
  sortTracks,
} from '../library';
import type { RawTrack, TrackStat } from '../types';
import { buildTrackStats } from '../stats';
import { libOf, play, raw } from './fixtures';

const D = (n: number) => Date.UTC(2024, 0, n);
const bolly = { album: 'Aashiqui 2', albumId: 'al1', year: 2013, folder: 'Music/Bollywood/' };
const punjabi = { album: 'Punjabi Hits', albumId: 'al2', folder: 'Music/Punjabi/' };
const dilSe = { album: 'Dil Se..', albumId: 'al3', year: 1998, albumArtist: 'A.R. Rahman', folder: 'Music/Old Hindi/' };

const rows: Partial<RawTrack>[] = [
  { id: 'a1', title: 'Tum Hi Ho', artist: 'Arijit Singh', ...bolly, track: 1, durationMs: 262_000, genre: 'Bollywood', dateAdded: D(10) },
  { id: 'a2', title: 'Sunn Raha Hai', artist: 'Ankit Tiwari', ...bolly, track: 2, durationMs: 380_000, genre: 'bollywood', dateAdded: D(11) },
  { id: 'a3', title: 'Milne Hai Mujhse Aayi', artist: 'Arijit Singh', ...bolly, track: 4, durationMs: 295_000, genre: 'Bollywood Music', dateAdded: D(12) },
  { id: 'a4', title: 'Chahun Main Ya Naa', artist: 'Arijit Singh, Palak Muchhal', ...bolly, track: 3, durationMs: 304_000, dateAdded: D(13) },
  { id: 'v1', title: 'Brown Munde', artist: 'AP Dhillon x Gurinder Gill', ...punjabi, year: 2020, track: 1001, durationMs: 267_000, genre: 'Punjabi', dateAdded: D(20) },
  { id: 'v2', title: 'Lover', artist: 'Diljit Dosanjh', ...punjabi, year: 2021, track: 1002, durationMs: 188_000, dateAdded: D(21) },
  { id: 'v3', title: 'Softly', artist: 'Karan Aujla', ...punjabi, year: 2023, track: 2001, durationMs: 170_000, dateAdded: D(22) },
  { id: 'v4', title: '295', artist: 'Sidhu Moose Wala', ...punjabi, year: 2022, track: 2002, durationMs: 270_000, dateAdded: D(23) },
  { id: 'd1', title: 'Dil Se Re', artist: 'A.R. Rahman', ...dilSe, track: 2, durationMs: 410_000, dateAdded: D(1) },
  { id: 'd2', title: 'Chaiyya Chaiyya', artist: 'Sukhwinder Singh & Sapna Awasthi', ...dilSe, track: 1, durationMs: 414_000, dateAdded: D(2) },
  {
    id: 'r1',
    title: 'Kun Faya Kun',
    artist: 'A.R. Rahman, Javed Ali, Mohit Chauhan',
    albumArtist: 'A.R. Rahman',
    album: 'Rockstar',
    albumId: 'al4',
    year: 2011,
    track: 1,
    durationMs: 473_000,
    folder: 'Music/Rockstar/',
    dateAdded: D(5),
  },
  {
    id: 'u1',
    title: '',
    artist: '<unknown>',
    album: '',
    albumId: '',
    year: 0,
    track: 0,
    fileName: 'Kesariya_(PagalWorld.com).mp3',
    folder: 'Download/',
    durationMs: 268_000,
    dateAdded: D(30),
  },
];

const lib = libOf(rows);
const ids = (list: { id: string }[]) => list.map((x) => x.id);
const unknownAlbum = lib.albums.find((a) => a.title === 'Unknown album');

describe('decodeTrackNumber', () => {
  it('decodes disc * 1000 + track and lets an explicit disc win', () => {
    expect(decodeTrackNumber(1003, 0)).toEqual({ trackNo: 3, discNo: 1 });
    expect(decodeTrackNumber(2002, 0)).toEqual({ trackNo: 2, discNo: 2 });
    expect(decodeTrackNumber(1003, 2)).toEqual({ trackNo: 3, discNo: 2 });
    expect(decodeTrackNumber(5, 0)).toEqual({ trackNo: 5, discNo: null });
    expect(decodeTrackNumber(0, 0)).toEqual({ trackNo: null, discNo: null });
  });
});

describe('buildLibrary', () => {
  it('cleans unknowns and falls back to the file name', () => {
    const u = lib.byId.get('u1');
    expect(u).toMatchObject({ title: 'Kesariya', artist: 'Unknown artist', album: 'Unknown album', year: null, trackNo: null });
    expect(u?.artists).toEqual(['Unknown artist']);
    expect(unknownAlbum?.artist).toBe('Unknown artist');
  });

  it('splits credits and decodes disc numbers', () => {
    expect(lib.byId.get('v1')).toMatchObject({ artists: ['AP Dhillon', 'Gurinder Gill'], trackNo: 1, discNo: 1 });
    expect(lib.byId.get('v3')).toMatchObject({ trackNo: 1, discNo: 2 });
    expect(lib.byId.get('a1')).toMatchObject({ trackNo: 1, discNo: null, albumArtist: 'Arijit Singh' });
    expect(lib.byId.get('d2')?.artists).toEqual(['Sukhwinder Singh', 'Sapna Awasthi']);
  });

  it('groups and sorts albums with sensible album artists', () => {
    expect(ids(lib.albums)).toEqual(['al1', 'al3', 'al2', 'al4', unknownAlbum?.id]);
    expect(lib.albumById.get('al1')).toMatchObject({ artist: 'Arijit Singh', year: 2013, trackIds: ['a1', 'a2', 'a4', 'a3'] });
    expect(lib.albumById.get('al2')).toMatchObject({ artist: 'Various artists', year: 2023 });
    expect(lib.albumById.get('al3')?.artist).toBe('A.R. Rahman');
    expect(ids(albumTracks(lib, 'al2'))).toEqual(['v1', 'v2', 'v3', 'v4']);
    expect(albumTracks(lib, 'nope')).toEqual([]);
  });

  it('credits every split artist and sorts unknown last', () => {
    expect(lib.artists).toHaveLength(14);
    expect(lib.artists[0].name).toBe('Ankit Tiwari');
    expect(lib.artists[lib.artists.length - 1].name).toBe('Unknown artist');
    expect(lib.artistById.get('ar rahman')?.trackIds).toEqual(['d1', 'r1']);
    expect(lib.artistById.get('arijit singh')?.trackIds).toHaveLength(3);
    expect(lib.artistById.get('gurinder gill')?.trackIds).toEqual(['v1']);
    expect(ids(artistAlbums(lib, 'ar rahman'))).toEqual(['al4', 'al3']);
    expect(ids(artistAlbums(lib, 'mohit chauhan'))).toEqual(['al4']);
    expect(artistAlbums(lib, 'nobody')).toEqual([]);
  });

  it('groups genres by normalized tag and folders by path', () => {
    expect(lib.genres.map((g) => [g.id, g.name, g.trackIds.length])).toEqual([
      ['bollywood', 'Bollywood', 2],
      ['bollywood music', 'Bollywood Music', 1],
      ['punjabi', 'Punjabi', 1],
    ]);
    expect(lib.folders.map((f) => f.name)).toEqual(['Bollywood', 'Download', 'Old Hindi', 'Punjabi', 'Rockstar']);
    expect(lib.folders[0]).toMatchObject({ id: 'Music/Bollywood/', trackIds: expect.arrayContaining(['a1', 'a4']) });
    expect(lib.totalDurationMs).toBe(3_701_000);
  });

  it('labels an album with many tagged album artists as various artists', () => {
    const va = buildLibrary([
      raw({ id: 'x1', album: 'Coke Studio', albumArtist: 'Various Artists', artist: 'Ali Sethi' }),
      raw({ id: 'x2', album: 'Coke Studio', albumArtist: 'Various Artists', artist: 'Shae Gill' }),
    ]);
    expect(va.albums).toHaveLength(1);
    expect(va.albums[0].artist).toBe('Various artists');
  });

  it('handles an empty library and duplicate ids', () => {
    const empty = buildLibrary([]);
    expect(empty).toMatchObject({ tracks: [], albums: [], artists: [], genres: [], folders: [], totalDurationMs: 0 });
    expect(buildLibrary([raw({ id: 'dup' }), raw({ id: 'dup' })]).tracks).toHaveLength(1);
  });
});

describe('sorting', () => {
  const byTitle = sortTracks(lib.tracks, 'title');

  it('sorts by title with an A-Z section index', () => {
    expect(byTitle.map((t) => t.title)).toEqual([
      'Brown Munde',
      'Chahun Main Ya Naa',
      'Chaiyya Chaiyya',
      'Dil Se Re',
      'Kesariya',
      'Kun Faya Kun',
      'Lover',
      'Milne Hai Mujhse Aayi',
      'Softly',
      'Sunn Raha Hai',
      'Tum Hi Ho',
      '295',
    ]);
    expect(sectionIndex(byTitle, (t) => t.title)).toEqual({
      letters: ['B', 'C', 'D', 'K', 'L', 'M', 'S', 'T', '#'],
      offsets: { B: 0, C: 1, D: 3, K: 4, L: 6, M: 7, S: 8, T: 10, '#': 11 },
    });
    expect(sectionIndex([], (x: string) => x)).toEqual({ letters: [], offsets: {} });
  });

  it('uses sensible defaults and secondary keys', () => {
    expect(ids(sortTracks(lib.tracks, 'added'))).toEqual(['u1', 'v4', 'v3', 'v2', 'v1', 'a4', 'a3', 'a2', 'a1', 'r1', 'd2', 'd1']);
    expect(ids(sortTracks(lib.tracks, 'year'))).toEqual(['d1', 'd2', 'r1', 'a2', 'a1', 'a4', 'a3', 'v1', 'v2', 'v4', 'v3', 'u1']);
    expect(ids(sortTracks(lib.tracks, 'year', undefined, true))).toEqual([
      'v3', 'v4', 'v2', 'v1', 'a2', 'a1', 'a4', 'a3', 'r1', 'd1', 'd2', 'u1',
    ]);
    expect(ids(sortTracks(lib.tracks, 'duration'))).toEqual(['v3', 'v2', 'a1', 'v1', 'u1', 'v4', 'a3', 'a4', 'a2', 'd1', 'd2', 'r1']);
    expect(ids(sortTracks(lib.tracks, 'artist'))).toEqual(['a2', 'v1', 'd1', 'r1', 'a1', 'a4', 'a3', 'v2', 'v3', 'v4', 'd2', 'u1']);
    expect(ids(sortTracks(lib.tracks, 'album')).slice(0, 4)).toEqual(['a1', 'a2', 'a4', 'a3']);
  });

  it('sorts by plays, most first, ties by most recent', () => {
    const plays = [
      ...Array.from({ length: 10 }, (_, i) => play('a1', D(40) + i * 1000)),
      ...Array.from({ length: 10 }, (_, i) => play('v1', D(41) + i * 1000)),
      ...Array.from({ length: 3 }, (_, i) => play('a2', D(42) + i * 1000)),
    ];
    const stats: Map<string, TrackStat> = buildTrackStats(plays);
    expect(ids(sortTracks(lib.tracks, 'plays', stats)).slice(0, 3)).toEqual(['v1', 'a1', 'a2']);
    expect(ids(sortTracks(lib.tracks, 'plays')).length).toBe(12);
  });

  it('is stable and does not mutate the input', () => {
    const before = ids(lib.tracks);
    sortTracks(lib.tracks, 'duration', undefined, true);
    expect(ids(lib.tracks)).toEqual(before);
    const same = libOf([{ id: 's1', title: 'Same' }, { id: 's2', title: 'Same' }]).tracks;
    expect(ids(sortTracks(same, 'duration'))).toEqual(ids(same));
  });

  it('sorts albums', () => {
    const u = unknownAlbum?.id;
    expect(ids(sortAlbums(lib.albums, 'year'))).toEqual(['al2', 'al1', 'al4', 'al3', u]);
    expect(ids(sortAlbums(lib.albums, 'artist'))).toEqual(['al3', 'al4', 'al1', u, 'al2']);
    expect(ids(sortAlbums(lib.albums, 'added'))).toEqual([u, 'al2', 'al1', 'al4', 'al3']);
    expect(ids(sortAlbums(lib.albums, 'title'))).toEqual(ids(lib.albums));
  });
});
