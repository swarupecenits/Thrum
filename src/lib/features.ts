import { artistIdOf, primaryArtist } from './library';
import { familyCandidates, priorPoint } from './moods';
import { compareKeys, normalize, sortKey } from './text';
import type { Features, ScoredTrack, Track, VibeContext } from './types';

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

const WEIGHTS = { energy: 1.5, valence: 1, danceability: 0.8, acousticness: 0.8, bass: 1.2, brightness: 0.6 } as const;
const TEMPO_WEIGHT = 1;
const DIMENSIONS = Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[];

/** 0..1 distance between tempos on a log scale, folded by octave so half/double time count as equal. */
export function tempoDistance(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0.5;
  const octaves = Math.abs(Math.log2(a / b)) % 1;
  return Math.min(1, Math.min(octaves, 1 - octaves) / 0.3);
}

/** 0..1 sound similarity: weighted RMS over the main descriptors plus a small bonus for compatible keys. */
export function similarity(a: Features, b: Features): number {
  let sum = 0;
  let weights = 0;
  for (const k of DIMENSIONS) {
    const x = a[k];
    const y = b[k];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    sum += WEIGHTS[k] * (x - y) * (x - y);
    weights += WEIGHTS[k];
  }
  const t = tempoDistance(a.bpm, b.bpm);
  sum += TEMPO_WEIGHT * t * t;
  weights += TEMPO_WEIGHT;
  const d = Math.sqrt(sum / weights);
  return clamp01(1 - Math.min(1, 1.5 * d) + (harmonicCompatible(a, b) ? 0.05 : 0));
}

function validKey(key: number): boolean {
  return Number.isInteger(key) && key >= 0 && key <= 11;
}

/** Camelot wheel code ("8A" = A minor, "8B" = C major), '' when the key is unknown. */
export function camelot(key: number, mode: number): string {
  if (!validKey(key)) return '';
  const major = mode === 1;
  const pitch = major ? key : (key + 3) % 12;
  const n = ((((pitch * 7) % 12) + 7) % 12) + 1;
  return `${n}${major ? 'B' : 'A'}`;
}

const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

/** "A minor", "Db major"; '' when unknown. */
export function keyName(key: number, mode: number): string {
  if (!validKey(key)) return '';
  return mode === 1 ? `${MAJOR_NAMES[key]} major` : `${MINOR_NAMES[key]} minor`;
}

/** Same Camelot code, a neighbour on the wheel, or the relative major/minor. */
export function harmonicCompatible(a: Features, b: Features): boolean {
  const ca = camelot(a.key, a.mode);
  const cb = camelot(b.key, b.mode);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const na = parseInt(ca, 10);
  const nb = parseInt(cb, 10);
  if (ca.endsWith('A') === cb.endsWith('A')) {
    const diff = Math.abs(na - nb);
    return diff === 1 || diff === 11;
  }
  return na === nb;
}

/** Mood Map position: analysed energy/valence when available, else genre/keyword priors. */
export function pointOf(track: Track, f: Features | undefined): { energy: number; valence: number } {
  if (f && Number.isFinite(f.energy) && Number.isFinite(f.valence)) {
    return { energy: clamp01(f.energy), valence: clamp01(f.valence) };
  }
  return priorPoint(track);
}

function familyMatch(a: Track, b: Track): number {
  const fa = familyCandidates(a);
  const fb = familyCandidates(b);
  if (!fa.length || !fb.length) return 0.3;
  return fa.some((f) => fb.includes(f)) ? 1 : 0;
}

function sharesArtist(a: Track, b: Track): boolean {
  const ids = new Set(a.artists.map(artistIdOf));
  return b.artists.some((n) => ids.has(artistIdOf(n)));
}

function eraCloseness(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0.4;
  return clamp01(1 - Math.abs(a - b) / 15);
}

/** How well `t` follows `seed` in a "sounds like this" radio, 0..1. */
export function pairScore(seed: Track, t: Track, ctx: VibeContext): number {
  const fs = ctx.features.get(seed.id);
  const ft = ctx.features.get(t.id);
  const family = familyMatch(seed, t);
  const artist = sharesArtist(seed, t) ? 1 : 0;
  const era = eraCloseness(seed.year, t.year);
  if (fs && ft) return clamp01(0.75 * similarity(fs, ft) + 0.1 * family + 0.08 * artist + 0.04 * era);
  const pa = pointOf(seed, fs);
  const pb = pointOf(t, ft);
  const point = 1 - Math.hypot(pa.energy - pb.energy, pa.valence - pb.valence) / Math.SQRT2;
  return clamp01(0.35 * point + 0.3 * family + 0.2 * artist + 0.15 * era);
}

/** Picks from a ranked list while capping repeats per album/artist; relaxes the caps when short. */
export function pickVaried(
  ranked: { t: Track; score: number }[],
  limit: number,
  perAlbum: number,
  perArtist: number,
): { t: Track; score: number }[] {
  const out: { t: Track; score: number }[] = [];
  const taken = new Set<string>();
  const albums = new Map<string, number>();
  const artists = new Map<string, number>();
  for (const pass of [1, 2, 4]) {
    for (const r of ranked) {
      if (out.length >= limit) return out;
      if (taken.has(r.t.id)) continue;
      const al = albums.get(r.t.albumId) ?? 0;
      const ar = artistIdOf(primaryArtist(r.t));
      const arn = artists.get(ar) ?? 0;
      if (al >= perAlbum * pass || arn >= perArtist * pass) continue;
      out.push(r);
      taken.add(r.t.id);
      albums.set(r.t.albumId, al + 1);
      artists.set(ar, arn + 1);
    }
  }
  for (const r of ranked) {
    if (out.length >= limit) break;
    if (!taken.has(r.t.id)) {
      out.push(r);
      taken.add(r.t.id);
    }
  }
  return out;
}

/** "Sounds like this" radio: never includes the seed (or another copy of the same song). */
export function similarTracks(seedId: string, ctx: VibeContext, limit = 50): ScoredTrack[] {
  const seed = ctx.lib.byId.get(seedId);
  if (!seed || limit <= 0) return [];
  const seedTitle = normalize(seed.title);
  const seedArtist = artistIdOf(primaryArtist(seed));
  const ranked: { t: Track; score: number; key: string }[] = [];
  for (const t of ctx.lib.tracks) {
    if (t.id === seedId) continue;
    if (normalize(t.title) === seedTitle && artistIdOf(primaryArtist(t)) === seedArtist) continue;
    ranked.push({ t, score: pairScore(seed, t, ctx), key: sortKey(t.title) });
  }
  ranked.sort((a, b) => b.score - a.score || compareKeys(a.key, b.key) || (a.t.id < b.t.id ? -1 : 1));
  return pickVaried(ranked, limit, 2, 3).map((r) => ({ id: r.t.id, score: r.score }));
}

/** "Slow" < 85 bpm, "Mid-tempo", "Upbeat" >= 118, "Fast" >= 140; '' when unknown. */
export function tempoLabel(bpm: number): string {
  if (!Number.isFinite(bpm) || bpm <= 0) return '';
  if (bpm < 85) return 'Slow';
  if (bpm < 118) return 'Mid-tempo';
  if (bpm < 140) return 'Upbeat';
  return 'Fast';
}

export function energyLabel(e: number): string {
  if (!Number.isFinite(e)) return '';
  if (e < 0.25) return 'Calm';
  if (e < 0.45) return 'Mellow';
  if (e < 0.65) return 'Balanced';
  if (e < 0.8) return 'Energetic';
  return 'Intense';
}
