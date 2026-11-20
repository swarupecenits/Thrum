import { buildLibrary } from '../library';
import { SAMPLE_NOW, sampleLibrary } from '../sample-library';
import { buildTrackStats } from '../stats';
import type { Features, Library, PlayEvent, RawTrack, VibeContext } from '../types';

let seq = 0;

/** A MediaStore row with sensible defaults; ids are unique unless given. */
export function raw(p: Partial<RawTrack> = {}): RawTrack {
  seq++;
  const id = p.id ?? `r${seq}`;
  return {
    id,
    title: `Song ${id}`,
    artist: 'Test Artist',
    album: 'Test Album',
    albumId: '',
    albumArtist: '',
    genre: '',
    year: 2020,
    track: 0,
    disc: 0,
    durationMs: 200_000,
    folder: 'Music/',
    fileName: `${id}.mp3`,
    mime: 'audio/mpeg',
    bitrate: 320_000,
    size: 8_000_000,
    dateAdded: Date.UTC(2024, 0, 1),
    dateModified: Date.UTC(2024, 0, 1),
    ...p,
  };
}

export function libOf(rows: Partial<RawTrack>[]): Library {
  return buildLibrary(rows.map((r) => raw(r)));
}

export function feat(p: Partial<Features> = {}): Features {
  return {
    v: 1,
    bpm: 110,
    bpmConfidence: 0.8,
    energy: 0.5,
    loudnessLufs: -10,
    peak: 0.9,
    dynamics: 0.5,
    bass: 0.5,
    subBass: 0.4,
    brightness: 0.5,
    flatness: 0.2,
    danceability: 0.5,
    valence: 0.5,
    acousticness: 0.3,
    key: 0,
    mode: 1,
    keyConfidence: 0.7,
    onsetRate: 3,
    ...p,
  };
}

export function play(trackId: string, startedAt: number, p: Partial<PlayEvent> = {}): PlayEvent {
  return { trackId, startedAt, playedMs: 190_000, durationMs: 200_000, completed: true, skipped: false, ...p };
}

/** Local-time epoch ms (tests construct dates the way the app sees them). */
export function local(y: number, month: number, d: number, h = 12, min = 0): number {
  return new Date(y, month - 1, d, h, min).getTime();
}

export function ctxOf(
  lib: Library,
  opts: { features?: Record<string, Features>; plays?: PlayEvent[]; favorites?: string[]; now?: number } = {},
): VibeContext {
  return {
    lib,
    features: new Map(Object.entries(opts.features ?? {})),
    stats: buildTrackStats(opts.plays ?? []),
    favorites: new Set(opts.favorites ?? []),
    now: opts.now ?? local(2025, 1, 15),
  };
}

type Sample = ReturnType<typeof sampleLibrary> & { lib: Library; ctx: VibeContext };
let cached: Sample | null = null;

/** The demo library, built once per test file. Tum Hi Ho is '1001', Kesariya '1006'. */
export function sample(): Sample {
  if (!cached) {
    const s = sampleLibrary();
    const lib = buildLibrary(s.raw);
    cached = {
      ...s,
      lib,
      ctx: {
        lib,
        features: new Map(Object.entries(s.features)),
        stats: buildTrackStats(s.plays),
        favorites: new Set(['1001', '1036']),
        now: SAMPLE_NOW,
      },
    };
  }
  return cached;
}

export function titleOf(lib: Library, id: string): string {
  return lib.byId.get(id)?.title ?? `?${id}`;
}
