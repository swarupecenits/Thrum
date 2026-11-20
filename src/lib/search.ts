import { genreFamily, genreFamilyLabel } from './moods';
import { compareKeys, normalize, scoreNormalized, sortKey, tokenScore } from './text';
import type { Album, Artist, Genre, Library, Playlist, SearchHit, SearchHitKind, SearchResults, Track } from './types';

/** Opaque handle; the precomputed data lives in a WeakMap so callers can't depend on its shape. */
export type SearchIndex = { readonly searchIndex: true; readonly size: number };

type Field = { ids: Int32Array; text: string; initials: string; compact: string; weight: number };
type Item<T> = { id: string; key: string; fields: Field[]; ref: T };
type IndexData = {
  vocab: string[];
  tracks: Item<Track>[];
  albums: Item<Album>[];
  artists: Item<Artist>[];
  playlists: Item<Playlist>[];
  genres: Item<Genre>[];
};

const DATA = new WeakMap<SearchIndex, IndexData>();

const KIND_BIAS: Record<SearchHitKind, number> = {
  artist: 1.02,
  track: 1,
  album: 0.98,
  playlist: 0.97,
  genre: 0.9,
  folder: 0.85,
};

type Vocab = { words: string[]; id: (w: string) => number };

function makeVocab(): Vocab {
  const words: string[] = [];
  const ids = new Map<string, number>();
  return {
    words,
    id(w) {
      let id = ids.get(w);
      if (id === undefined) {
        id = words.length;
        words.push(w);
        ids.set(w, id);
      }
      return id;
    },
  };
}

function field(vocab: Vocab, raw: string, weight: number): Field | null {
  const text = normalize(raw);
  if (!text) return null;
  const toks = text.split(' ');
  const ids = new Int32Array(toks.length);
  let initials = '';
  toks.forEach((t, i) => {
    ids[i] = vocab.id(t);
    initials += t[0];
  });
  return { ids, text, initials: toks.length > 1 ? initials : '', compact: toks.length > 1 ? toks.join('') : '', weight };
}

function item<T>(vocab: Vocab, id: string, name: string, ref: T, specs: [string, number][]): Item<T> {
  const fields: Field[] = [];
  for (const [raw, w] of specs) {
    const f = field(vocab, raw, w);
    if (f) fields.push(f);
  }
  return { id, key: sortKey(name), fields, ref };
}

/** Precomputes normalized fields and a shared token vocabulary for fast fuzzy search. */
export function buildSearchIndex(lib: Library, playlists: Playlist[]): SearchIndex {
  const vocab = makeVocab();
  const data: IndexData = {
    vocab: vocab.words,
    tracks: lib.tracks.map((t) =>
      item(vocab, t.id, t.title, t, [
        [t.title, 1],
        [t.artists.join(' '), 0.8],
        [t.album, 0.6],
        [t.genre, 0.4],
      ]),
    ),
    albums: lib.albums.map((a) =>
      item(vocab, a.id, a.title, a, [
        [a.title, 1],
        [a.artist, 0.75],
      ]),
    ),
    artists: lib.artists.map((a) => item(vocab, a.id, a.name, a, [[a.name, 1]])),
    playlists: (playlists ?? []).map((p) => item(vocab, p.id, p.name, p, [[p.name, 1]])),
    genres: lib.genres.map((g) => {
      const family = genreFamily(g.name);
      return item(vocab, g.id, g.name, g, [
        [g.name, 1],
        [family ? genreFamilyLabel(family) : '', 0.8],
      ]);
    }),
  };
  const handle: SearchIndex = Object.freeze({ searchIndex: true as const, size: lib.tracks.length });
  DATA.set(handle, data);
  return handle;
}

type Query = { text: string; key: string; words: string[]; scores: Float32Array[] };

function wordScore(q: Query, w: number, f: Field): number {
  const table = q.scores[w];
  let best = 0;
  for (let i = 0; i < f.ids.length; i++) {
    const s = table[f.ids[i]];
    if (s > best) best = s;
  }
  if (best < 0.7 && f.initials) {
    const word = q.words[w];
    if (word.length >= 2 && (f.initials === word || (word.length >= 3 && f.initials.startsWith(word)))) best = 0.7;
  }
  if (best < 0.55 && f.compact && q.words[w].length >= 5 && f.compact.includes(q.words[w])) best = 0.55;
  return best;
}

/** 0 when some query word matches no field; otherwise the better of word-level and phrase-level scores. */
function scoreItem(q: Query, it: Item<unknown>): number {
  let sum = 0;
  let min = 1;
  for (let w = 0; w < q.words.length; w++) {
    let best = 0;
    for (const f of it.fields) {
      const s = wordScore(q, w, f) * f.weight;
      if (s > best) best = s;
    }
    if (best === 0) return 0;
    sum += best;
    if (best < min) min = best;
  }
  const words = 0.75 * (sum / q.words.length) + 0.25 * min;
  let phrase = 0;
  for (const f of it.fields) {
    const s = scoreNormalized(q.text, f.text) * f.weight;
    if (s > phrase) phrase = s;
  }
  return Math.max(words, phrase);
}

type Ranked<T> = { hits: SearchHit[]; refs: T[]; exact: SearchHit | null };

function rank<T>(q: Query, items: Item<T>[], kind: SearchHitKind, limit: number): Ranked<T> {
  const scored: { it: Item<T>; s: number }[] = [];
  for (const it of items) {
    const s = scoreItem(q, it);
    if (s > 0) scored.push({ it, s: s * KIND_BIAS[kind] });
  }
  scored.sort((a, b) => b.s - a.s || compareKeys(a.it.key, b.it.key) || (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0));
  const top = scored.slice(0, Math.max(0, limit));
  const hits = top.map((x) => ({ kind, id: x.it.id, score: x.s }));
  // The whole name typed out ("punjabi" -> the Punjabi genre, "dil se" -> the album).
  const exactAt = top.findIndex((x) => x.it.key === q.key || x.it.fields[0]?.text === q.text);
  return { hits, refs: top.map((x) => x.it.ref), exact: exactAt >= 0 ? hits[exactAt] : null };
}

function empty(query: string): SearchResults {
  return { query, top: null, tracks: [], albums: [], artists: [], playlists: [], genres: [] };
}

/** Fuzzy search across kinds; every query word must match somewhere in an item ("tum hi ho arijit"). */
export function search(index: SearchIndex, query: string, limit = 30): SearchResults {
  const data = DATA.get(index);
  const text = normalize(query ?? '');
  if (!data || !text) return empty(query);
  const words = [...new Set(text.split(' '))];
  const scores = words.map((w) => {
    const table = new Float32Array(data.vocab.length);
    for (let i = 0; i < data.vocab.length; i++) table[i] = tokenScore(w, data.vocab[i]);
    return table;
  });
  const q: Query = { text, key: sortKey(text), words, scores };
  const tracks = rank(q, data.tracks, 'track', limit);
  const albums = rank(q, data.albums, 'album', limit);
  const artists = rank(q, data.artists, 'artist', limit);
  const playlists = rank(q, data.playlists, 'playlist', limit);
  const genres = rank(q, data.genres, 'genre', limit);
  const kinds = [artists, tracks, albums, playlists, genres];
  let top: SearchHit | null = null;
  for (const r of kinds) {
    if (r.exact && (!top || r.exact.score > top.score)) top = r.exact;
  }
  if (!top) {
    for (const r of kinds) {
      const h = r.hits[0];
      if (h && (!top || h.score > top.score)) top = h;
    }
  }
  return {
    query,
    top,
    tracks: tracks.refs,
    albums: albums.refs,
    artists: artists.refs,
    playlists: playlists.refs,
    genres: genres.refs,
  };
}
