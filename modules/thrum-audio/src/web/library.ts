import { coverSpec } from '../../../../src/lib/covers';
import { sampleLibrary } from '../../../../src/lib/sample-library';
import type { Palette, RawTrack, TrackFeatures } from '../ThrumAudio.types';
import { isRecord } from './util';

type Demo = { raw: RawTrack[]; byId: Map<string, RawTrack>; features: Record<string, TrackFeatures> };

let demo: Demo | null = null;

/** The deterministic sample library, built once on first use. */
export function demoLibrary(): Demo {
  if (!demo) {
    const { raw, features } = sampleLibrary();
    demo = { raw, features, byId: new Map(raw.map((t) => [t.id, t])) };
  }
  return demo;
}

export const findTrack = (id: string): RawTrack | undefined => demoLibrary().byId.get(id);

/** MediaScanner.normalizeFolder: `\Music//Old` → `Music/Old/`. */
function normalizeFolder(raw: string): string {
  const parts = raw.replace(/\\/g, '/').split('/').filter((p) => p.trim() !== '');
  return parts.length ? `${parts.join('/')}/` : '';
}

/** MediaStore fills a missing TITLE from the file name, so untagged files sort by that. */
const sortKey = (t: RawTrack): string => (t.title.trim() || t.fileName.replace(/\.[^.]*$/, '')).toLowerCase();

const byTitle = (a: RawTrack, b: RawTrack): number => {
  const x = sortKey(a);
  const y = sortKey(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Same filters and order as the MediaStore query: duration >= min, excluded folder prefixes, title A–Z. */
export function scanTracks(options: unknown): RawTrack[] {
  const o = isRecord(options) ? options : {};
  const min = typeof o.minDurationMs === 'number' ? Math.max(0, Math.trunc(o.minDurationMs) || 0) : 30_000;
  const excluded = (Array.isArray(o.excludedFolders) ? o.excludedFolders : [])
    .map((f) => (typeof f === 'string' ? normalizeFolder(f).toLowerCase() : ''))
    .filter((p) => p !== '');
  return demoLibrary()
    .raw.filter((t) => {
      if (t.durationMs < min) return false;
      if (!excluded.length) return true;
      const folder = normalizeFolder(t.folder).toLowerCase();
      return !excluded.some((p) => folder.startsWith(p));
    })
    .sort(byTitle);
}

/** Colours of the generated cover (see `coverSpec`), so ambient backgrounds match what the UI draws. */
export function paletteFor(albumId: string, trackId: string): Palette {
  const lib = demoLibrary();
  const track = lib.byId.get(trackId) ?? (albumId ? lib.raw.find((t) => t.albumId === albumId) : undefined);
  const [a, b, c] = coverSpec(albumId, track?.album ?? '').colors;
  return { dominant: a, vibrant: b, darkVibrant: a, lightVibrant: c, muted: b, darkMuted: a, lightMuted: c };
}
