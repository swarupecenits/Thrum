import { useState } from 'react';
import { useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MINI_GAP, MINI_H, TAB_BAR_H } from '../layout';

export const NOW_BAR_H = 56;
export const MINI_COVER = 44;
export const LYRICS_ART = 48;
/** Seek bar, transport and the action row, pinned to the bottom of Now Playing. */
export const CONTROLS_H = 236;
const TITLE_H = 92;
const ART_TOP_GAP = 12;
const MIN_ART = 150;
const MAX_ART = 520;

export type Rect = { x: number; y: number; size: number };

/** Top edge of the mini player; `tabs` (0..1) lifts it above the tab bar. */
export function miniTopFor(height: number, insetBottom: number, tabs: number): number {
  'worklet';
  return height - insetBottom - MINI_GAP - MINI_H - tabs * TAB_BAR_H;
}

export type NowGeometry = {
  width: number;
  height: number;
  insetTop: number;
  insetBottom: number;
  /** Big artwork, in window coordinates with the player fully open. */
  art: Rect;
  /** Top of the title block under the artwork. */
  titleTop: number;
  /** The thumbnail the artwork shrinks to while lyrics are showing. */
  lyricsArt: Rect;
  /** Top of the lyrics list. */
  lyricsTop: number;
  /** Distance from the bottom of the window to the top of the controls. */
  controlsBottom: number;
};

function compute(width: number, height: number, insetTop: number, insetBottom: number): NowGeometry {
  const controlsBottom = CONTROLS_H + insetBottom + 12;
  const artTop = insetTop + NOW_BAR_H + ART_TOP_GAP;
  const room = height - artTop - TITLE_H - controlsBottom;
  const size = Math.round(Math.max(MIN_ART, Math.min(width - 48, room, MAX_ART)));
  // Spread spare height so tall screens don't leave a hole under the title.
  const spare = Math.max(0, room - size);
  const art = { x: Math.round((width - size) / 2), y: Math.round(artTop + spare * 0.35), size };
  const lyricsArt = { x: 20, y: insetTop + NOW_BAR_H + 4, size: LYRICS_ART };
  return {
    width,
    height,
    insetTop,
    insetBottom,
    art,
    titleTop: art.y + size + 18 + Math.round(spare * 0.15),
    lyricsArt,
    lyricsTop: lyricsArt.y + LYRICS_ART + 14,
    controlsBottom,
  };
}

/**
 * Now Playing layout. The window size is a first guess; the overlay's own measured size wins,
 * because on Android the reported window height doesn't always include the system bars.
 */
export function useNowGeometry(): { geo: NowGeometry; onLayout: (e: LayoutChangeEvent) => void } {
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const w = measured?.w ?? win.width;
  const h = measured?.h ?? win.height;
  const geo = compute(w, h, insets.top, insets.bottom);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!measured || Math.abs(measured.w - width) > 0.5 || Math.abs(measured.h - height) > 0.5) {
      setMeasured({ w: width, h: height });
    }
  };
  return { geo, onLayout };
}
