import { hashString, mulberry32 } from '../../../../src/lib/random';
import type { TrackFeatures } from '../ThrumAudio.types';
import { demoLibrary } from './library';
import { clamp, round } from './util';

const unit = (x: number): number => round(clamp(x, 0.02, 0.98), 3);

/**
 * What the analyser "finds": the sample library's features when it has them, otherwise plausible
 * values seeded from the id (stable across calls and reloads).
 */
export function featuresFor(id: string): TrackFeatures {
  const known = demoLibrary().features[id];
  if (known) return { ...known };
  const rng = mulberry32(hashString(`analysis|${id}`));
  const energy = 0.3 + rng() * 0.6;
  const bass = 0.25 + rng() * 0.6;
  return {
    v: 1,
    bpm: round(78 + rng() * 64, 1),
    bpmConfidence: round(0.55 + rng() * 0.4, 3),
    energy: unit(energy),
    loudnessLufs: round(-15 + energy * 8 + (rng() - 0.5) * 2, 2),
    peak: round(0.86 + rng() * 0.14, 3),
    dynamics: unit(0.85 - energy * 0.6 + (rng() - 0.5) * 0.1),
    bass: unit(bass),
    subBass: unit(bass * 0.8 + (rng() - 0.5) * 0.1),
    brightness: unit(0.35 + rng() * 0.4 + (energy - 0.5) * 0.2),
    flatness: unit(0.1 + rng() * 0.2),
    danceability: unit(0.3 + rng() * 0.6),
    valence: unit(0.2 + rng() * 0.7),
    acousticness: unit(0.05 + rng() * 0.6),
    key: Math.floor(rng() * 12),
    mode: rng() < 0.5 ? 0 : 1,
    keyConfidence: round(0.4 + rng() * 0.5, 3),
    onsetRate: round(1 + energy * 5 + rng(), 2),
  };
}
