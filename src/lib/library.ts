import {
  cleanAlbum,
  cleanArtist,
  cleanGenre,
  cleanTitle,
  compareKeys,
  compareText,
  normalize,
  sectionLetter,
  sortKey,
  splitArtists,
  stripExtension,
} from './text';
import type { Album, Artist, Folder, Genre, Library, RawTrack, Track, TrackStat } from './types';

export const UNKNOWN_ARTIST = 'Unknown artist';
export const UNKNOWN_ALBUM = 'Unknown album';
export const VARIOUS_ARTISTS = 'Various artists';
const UNKNOWN_ARTIST_ID = normalize(UNKNOWN_ARTIST);

/** Stable artist id: the normalized name (raw lowercase for names made only of symbols, e.g. "!!!"). */
export function artistIdOf(name: string): string {
  return normalize(name) || name.trim().toLowerCase() || UNKNOWN_ARTIST_ID;
}
const VARIOUS_TAGS = new Set(['various artists', 'various artist', 'various', 'va', 'v a', 'multiple artists']);

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** Epoch ms; values that look like seconds (before 1973 as ms) are scaled up. */
function toMs(ts: number): number {
  const v = finite(ts);
  return v > 0 && v < 1e11 ? v * 1000 : Math.max(0, v);
}

function decodeYear(y: number): number | null {
  let v = Math.floor(finite(y));
  if (v > 9999) v = Number(String(v).slice(0, 4));
  return v >= 1900 && v <= 2100 ? v : null;
}

/** MediaStore may encode `disc * 1000 + track`; an explicit disc number wins. */
export function decodeTrackNumber(track: number, disc: number): { trackNo: number | null; discNo: number | null } {
  let trackNo = Math.max(0, Math.floor(finite(track)));
  let discNo = Math.max(0, Math.floor(finite(disc)));
  if (trackNo >= 1000) {
    if (!discNo) discNo = Math.floor(trackNo / 1000);
    trackNo %= 1000;
  }
  return { trackNo: trackNo || null, discNo: discNo || null };
}

function credits(line: string): string[] {
  const cleaned = cleanArtist(line);
  if (!cleaned) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of splitArtists(cleaned)) {
    const name = cleanArtist(part);
    const key = normalize(name) || name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Most frequent value by normalized form (ties: first seen), in its first-seen capitalised spelling. */
function mostCommon(values: string[]): string {
  const counts = new Map<string, { name: string; n: number; order: number }>();
  values.forEach((v, order) => {
    const k = normalize(v);
    if (!k) return;
    const c = counts.get(k);
    if (!c) counts.set(k, { name: v, n: 1, order });
    else {
      c.n++;
      // "bollywood" + "Bollywood" should display as "Bollywood".
      if (c.name === c.name.toLowerCase() && v !== v.toLowerCase()) c.name = v;
    }
  });
  let best: { name: string; n: number; order: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n || (c.n === best.n && c.order < best.order)) best = c;
  return best ? best.name : '';
}

/** Display name for a folder path: its last segment ("Music/Old Hindi/" -> "Old Hindi"). */
export function folderName(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : 'Internal storage';
}

export function primaryArtist(t: Track): string {
  return t.artists[0] ?? t.artist;
}

function byDiscAndNumber(a: Track, b: Track): number {
  return (
    (a.discNo ?? 1) - (b.discNo ?? 1) ||
    (a.trackNo ?? 1e6) - (b.trackNo ?? 1e6) ||
    compareText(a.title, b.title) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function sortByName<T extends { id: string }>(items: T[], nameOf: (t: T) => string, last?: string): T[] {
  const keyed = items.map((it) => ({ it, k: sortKey(nameOf(it)) }));
  keyed.sort(
    (a, b) =>
      Number(a.it.id === last) - Number(b.it.id === last) ||
      compareKeys(a.k, b.k) ||
      (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0),
  );
  return keyed.map((x) => x.it);
}

type Draft = { track: Track; albumArtistTag: string };

function draftTrack(r: RawTrack): Draft {
  const artists = credits(r.artist);
  const album = cleanAlbum(r.album) || UNKNOWN_ALBUM;
  const albumArtistTag = cleanArtist(r.albumArtist);
  const { trackNo, discNo } = decodeTrackNumber(r.track, r.disc);
  const folder = r.folder || '';
  const albumId =
    r.albumId ||
    (album === UNKNOWN_ALBUM ? `a:?|${folder}` : `a:${normalize(album)}|${normalize(albumArtistTag)}`);
  const track: Track = {
    id: r.id,
    title: cleanTitle(r.title) || cleanTitle(r.fileName) || stripExtension(r.fileName || '').trim() || 'Untitled',
    artist: artists.length ? artists.join(', ') : UNKNOWN_ARTIST,
    artists: artists.length ? artists : [UNKNOWN_ARTIST],
    album,
    albumId,
    albumArtist: '',
    genre: cleanGenre(r.genre),
    year: decodeYear(r.year),
    trackNo,
    discNo,
    durationMs: Math.max(0, finite(r.durationMs)),
    folder,
    fileName: r.fileName || '',
    mime: r.mime || '',
    bitrate: finite(r.bitrate) > 0 ? r.bitrate : null,
    size: Math.max(0, finite(r.size)),
    dateAdded: toMs(r.dateAdded),
    dateModified: toMs(r.dateModified),
  };
  return { track, albumArtistTag };
}

function albumArtistFor(drafts: Draft[]): string {
  const tag = mostCommon(drafts.map((d) => d.albumArtistTag));
  if (tag) return VARIOUS_TAGS.has(normalize(tag)) ? VARIOUS_ARTISTS : tag;
  const primaries = drafts.map((d) => primaryArtist(d.track));
  const distinct = new Set(primaries.map(normalize));
  return distinct.size > 3 ? VARIOUS_ARTISTS : mostCommon(primaries) || UNKNOWN_ARTIST;
}

function albumYear(tracks: Track[]): number | null {
  const counts = new Map<number, number>();
  for (const t of tracks) if (t.year !== null) counts.set(t.year, (counts.get(t.year) ?? 0) + 1);
  let best: number | null = null;
  let bestN = 0;
  for (const [y, n] of counts) if (n > bestN || (n === bestN && best !== null && y > best)) [best, bestN] = [y, n];
  return best;
}

/** Turns raw MediaStore rows into a cleaned, grouped and sorted library. */
export function buildLibrary(raw: RawTrack[]): Library {
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  for (const r of raw ?? []) {
    if (!r || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    drafts.push(draftTrack(r));
  }

  const titleKeys = new Map<Draft, string>();
  for (const d of drafts) titleKeys.set(d, sortKey(d.track.title));
  drafts.sort(
    (a, b) =>
      compareKeys(titleKeys.get(a) ?? '', titleKeys.get(b) ?? '') ||
      compareText(a.track.artist, b.track.artist) ||
      (a.track.id < b.track.id ? -1 : a.track.id > b.track.id ? 1 : 0),
  );

  const albumGroups = new Map<string, Draft[]>();
  for (const d of drafts) {
    const g = albumGroups.get(d.track.albumId);
    if (g) g.push(d);
    else albumGroups.set(d.track.albumId, [d]);
  }
  const albumList: Album[] = [];
  for (const [id, group] of albumGroups) {
    const artist = albumArtistFor(group);
    const tracks = group.map((d) => d.track);
    for (const t of tracks) t.albumArtist = artist;
    const ordered = [...tracks].sort(byDiscAndNumber);
    albumList.push({
      id,
      title: mostCommon(tracks.map((t) => t.album)) || UNKNOWN_ALBUM,
      artist,
      year: albumYear(tracks),
      trackIds: ordered.map((t) => t.id),
      durationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
      coverTrackId: ordered[0].id,
      dateAdded: tracks.reduce((m, t) => Math.max(m, t.dateAdded), 0),
    });
  }
  const albums = sortByName(albumList, (a) => a.title);
  const albumById = new Map(albums.map((a) => [a.id, a]));

  const tracks = drafts.map((d) => d.track);
  const byId = new Map(tracks.map((t) => [t.id, t]));

  const artistAcc = new Map<string, { names: string[]; trackIds: string[] }>();
  for (const t of tracks) {
    for (const name of t.artists) {
      const id = artistIdOf(name);
      const acc = artistAcc.get(id);
      if (acc) {
        acc.names.push(name);
        acc.trackIds.push(t.id);
      } else artistAcc.set(id, { names: [name], trackIds: [t.id] });
    }
  }
  const artistAlbumIds = new Map<string, Set<string>>();
  for (const a of albums) {
    const ids = new Set<string>();
    for (const tid of a.trackIds) for (const name of byId.get(tid)?.artists ?? []) ids.add(artistIdOf(name));
    for (const name of splitArtists(a.artist)) ids.add(artistIdOf(name));
    for (const id of ids) {
      if (!artistAcc.has(id)) continue;
      const set = artistAlbumIds.get(id) ?? new Set<string>();
      set.add(a.id);
      artistAlbumIds.set(id, set);
    }
  }
  const artists: Artist[] = sortByName(
    [...artistAcc].map(([id, acc]) => ({
      id,
      name: mostCommon(acc.names),
      trackIds: acc.trackIds,
      albumIds: [...(artistAlbumIds.get(id) ?? [])],
    })),
    (a) => a.name,
    UNKNOWN_ARTIST_ID,
  );
  const artistById = new Map(artists.map((a) => [a.id, a]));

  const genreAcc = new Map<string, { names: string[]; trackIds: string[] }>();
  const folderAcc = new Map<string, Track[]>();
  for (const t of tracks) {
    const gid = normalize(t.genre);
    if (gid) {
      const acc = genreAcc.get(gid);
      if (acc) {
        acc.names.push(t.genre);
        acc.trackIds.push(t.id);
      } else genreAcc.set(gid, { names: [t.genre], trackIds: [t.id] });
    }
    const f = folderAcc.get(t.folder);
    if (f) f.push(t);
    else folderAcc.set(t.folder, [t]);
  }
  const genres: Genre[] = sortByName(
    [...genreAcc].map(([id, acc]) => ({ id, name: mostCommon(acc.names), trackIds: acc.trackIds })),
    (g) => g.name,
  );
  const folders: Folder[] = sortByName(
    [...folderAcc].map(([id, list]) => ({
      id,
      name: folderName(id),
      trackIds: [...list].sort((a, b) => compareText(a.fileName, b.fileName) || (a.id < b.id ? -1 : 1)).map((t) => t.id),
    })),
    (f) => f.name,
  );

  return {
    tracks,
    byId,
    albums,
    albumById,
    artists,
    artistById,
    genres,
    folders,
    totalDurationMs: tracks.reduce((s, t) => s + t.durationMs, 0),
  };
}

export type TrackSort = 'title' | 'artist' | 'album' | 'added' | 'year' | 'duration' | 'plays';
export type AlbumSort = 'title' | 'artist' | 'year' | 'added';

type Keyed = {
  t: Track;
  i: number;
  title: string;
  artist: string;
  album: string;
  plays: number;
  last: number;
};

function cmpNum(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpYear(a: number | null, b: number | null, dir: number): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return dir * (a - b);
}

function albumOrder(a: Keyed, b: Keyed): number {
  return (
    compareKeys(a.album, b.album) ||
    compareText(a.t.albumId, b.t.albumId) ||
    (a.t.discNo ?? 1) - (b.t.discNo ?? 1) ||
    (a.t.trackNo ?? 1e6) - (b.t.trackNo ?? 1e6) ||
    compareKeys(a.title, b.title)
  );
}

/**
 * Stable sort with sensible secondary keys. `desc` flips only the primary key and defaults to
 * newest/most first for 'added' and 'plays'. Unknown years always sort last.
 */
export function sortTracks(tracks: Track[], sort: TrackSort, stats?: Map<string, TrackStat>, desc?: boolean): Track[] {
  const dir = (desc ?? (sort === 'added' || sort === 'plays')) ? -1 : 1;
  const keyed: Keyed[] = tracks.map((t, i) => {
    const st = stats?.get(t.id);
    return {
      t,
      i,
      title: sortKey(t.title),
      artist: sortKey(primaryArtist(t)),
      album: sortKey(t.album),
      plays: st?.plays ?? 0,
      last: st?.lastPlayedAt ?? 0,
    };
  });
  const primary = (a: Keyed, b: Keyed): number => {
    switch (sort) {
      case 'title':
        return dir * compareKeys(a.title, b.title) || compareKeys(a.artist, b.artist) || compareKeys(a.album, b.album);
      case 'artist':
        return dir * compareKeys(a.artist, b.artist) || albumOrder(a, b);
      case 'album':
        return dir * albumOrder(a, b);
      case 'added':
        return dir * cmpNum(a.t.dateAdded, b.t.dateAdded) || albumOrder(a, b);
      case 'year':
        return cmpYear(a.t.year, b.t.year, dir) || compareKeys(a.artist, b.artist) || albumOrder(a, b);
      case 'duration':
        return dir * cmpNum(a.t.durationMs, b.t.durationMs) || compareKeys(a.title, b.title);
      case 'plays':
        return dir * cmpNum(a.plays, b.plays) || cmpNum(b.last, a.last) || compareKeys(a.title, b.title);
      default:
        return 0;
    }
  };
  keyed.sort((a, b) => primary(a, b) || a.i - b.i);
  return keyed.map((k) => k.t);
}

export function sortAlbums(albums: Album[], sort: AlbumSort): Album[] {
  const keyed = albums.map((a, i) => ({ a, i, title: sortKey(a.title), artist: sortKey(a.artist) }));
  type K = (typeof keyed)[number];
  const cmp = (x: K, y: K): number => {
    switch (sort) {
      case 'title':
        return compareKeys(x.title, y.title) || compareKeys(x.artist, y.artist);
      case 'artist':
        return compareKeys(x.artist, y.artist) || cmpYear(x.a.year, y.a.year, 1) || compareKeys(x.title, y.title);
      case 'year':
        return cmpYear(x.a.year, y.a.year, -1) || compareKeys(x.title, y.title);
      case 'added':
        return cmpNum(y.a.dateAdded, x.a.dateAdded) || compareKeys(x.title, y.title);
      default:
        return 0;
    }
  };
  keyed.sort((x, y) => cmp(x, y) || x.i - y.i);
  return keyed.map((k) => k.a);
}

/** A-Z fast-scroll index: letters in order of first appearance with the index of that first item. */
export function sectionIndex<T>(items: T[], keyOf: (t: T) => string): { letters: string[]; offsets: Record<string, number> } {
  const letters: string[] = [];
  const offsets: Record<string, number> = {};
  items.forEach((item, i) => {
    const letter = sectionLetter(keyOf(item));
    if (offsets[letter] === undefined) {
      offsets[letter] = i;
      letters.push(letter);
    }
  });
  return { letters, offsets };
}

function resolve(lib: Library, ids: readonly string[] | undefined): Track[] {
  const out: Track[] = [];
  for (const id of ids ?? []) {
    const t = lib.byId.get(id);
    if (t) out.push(t);
  }
  return out;
}

export function albumTracks(lib: Library, albumId: string): Track[] {
  return resolve(lib, lib.albumById.get(albumId)?.trackIds);
}

export function artistTracks(lib: Library, artistId: string): Track[] {
  return resolve(lib, lib.artistById.get(artistId)?.trackIds);
}

export function genreTracks(lib: Library, genreId: string): Track[] {
  return resolve(lib, lib.genres.find((g) => g.id === genreId)?.trackIds);
}

export function folderTracks(lib: Library, folderId: string): Track[] {
  return resolve(lib, lib.folders.find((f) => f.id === folderId)?.trackIds);
}

/** The artist's own albums first (newest first), then albums they only appear on. */
export function artistAlbums(lib: Library, artistId: string): Album[] {
  const artist = lib.artistById.get(artistId);
  if (!artist) return [];
  const albums: Album[] = [];
  for (const id of artist.albumIds) {
    const a = lib.albumById.get(id);
    if (a) albums.push(a);
  }
  const own = (a: Album) => splitArtists(a.artist).some((n) => artistIdOf(n) === artistId);
  const keyed = albums.map((a) => ({ a, own: own(a), title: sortKey(a.title) }));
  keyed.sort(
    (x, y) =>
      Number(y.own) - Number(x.own) ||
      cmpYear(x.a.year, y.a.year, -1) ||
      compareKeys(x.title, y.title) ||
      compareText(x.a.id, y.a.id),
  );
  return keyed.map((k) => k.a);
}
