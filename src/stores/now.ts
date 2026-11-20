import { create } from 'zustand';

import { cachedArtwork, loadArtwork } from '@/audio/artwork';
import type { Palette as ArtPalette } from '@/audio/native';
import { ambientFrom, isDark, pickAccent } from '@/lib/color';
import { coverSpec } from '@/lib/covers';
import type { Track } from '@/lib/types';
import { bases, LIME } from '@/theme/palette';

export type Ambient = { top: string; mid: string; bottom: string; glow: string };

type NowState = {
  trackId: string | null;
  albumId: string | null;
  /** Large artwork, or null when the track has none (a generated cover is shown instead). */
  artUri: string | null;
  palette: ArtPalette | null;
  /** Adaptive accent drawn from the artwork; null until known. */
  accent: { color: string; on: string } | null;
  ambient: Ambient;
};

const BG = bases.ink.bg;

/** Generated covers have colours too, so "adaptive" works for tracks without artwork. */
export function paletteFromCover(albumId: string, label: string): ArtPalette {
  const [a, b, c] = coverSpec(albumId, label).colors;
  return { dominant: a, vibrant: b, darkVibrant: a, lightVibrant: c, muted: b, darkMuted: a, lightMuted: c };
}

function derive(palette: ArtPalette): Pick<NowState, 'accent' | 'ambient'> {
  const color = pickAccent(palette, LIME.color, BG);
  return {
    accent: { color, on: isDark(color) ? '#FAFAFA' : '#09090B' },
    ambient: ambientFrom(palette, '#27272A'),
  };
}

const IDLE: NowState = {
  trackId: null,
  albumId: null,
  artUri: null,
  palette: null,
  accent: null,
  ambient: ambientFrom(null, '#27272A'),
};

export const useNow = create<NowState>()(() => IDLE);

/** Follows the playing track: loads its large artwork and derives the ambient colours. */
export function setNowTrack(track: Track | null) {
  if (!track) {
    if (useNow.getState().trackId !== null) useNow.setState(IDLE);
    return;
  }
  const prev = useNow.getState();
  if (prev.trackId === track.id && prev.albumId === track.albumId) return;

  const apply = (uri: string | null, palette: ArtPalette | null) => {
    const p = palette ?? paletteFromCover(track.albumId, track.album);
    useNow.setState({ trackId: track.id, albumId: track.albumId, artUri: uri, palette: p, ...derive(p) });
  };

  const cached = cachedArtwork(track.albumId, track.id, 'lg');
  if (cached) {
    apply(cached.uri, cached.palette);
    return;
  }
  // Keep the current colours up while the new artwork loads, so the backdrop crossfades once (old
  // art to new) instead of flashing through a generated cover's palette on the way.
  if (prev.trackId) useNow.setState({ trackId: track.id, albumId: track.albumId });
  else apply(null, null);

  void loadArtwork(track.albumId, track.id, 'lg').then((r) => {
    if (useNow.getState().trackId === track.id) apply(r.uri, r.palette);
  });
}
