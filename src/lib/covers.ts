import { hashString, mulberry32 } from './random';
import { initials } from './text';
import type { CoverSpec } from './types';

/** Two deep jewel tones and one light accent each; all sit well on a near-black UI. */
export const COVER_PALETTES: [string, string, string][] = [
  ['#1E1B4B', '#4C1D95', '#C4B5FD'],
  ['#042F2E', '#115E59', '#5EEAD4'],
  ['#4C0519', '#9F1239', '#FDA4AF'],
  ['#172554', '#1E40AF', '#93C5FD'],
  ['#052E16', '#166534', '#BEF264'],
  ['#3B0764', '#86198F', '#F0ABFC'],
  ['#431407', '#9A3412', '#FDBA74'],
  ['#1C1917', '#57534E', '#FDE68A'],
  ['#083344', '#155E75', '#A5F3FC'],
  ['#2E1065', '#5B21B6', '#FBCFE8'],
  ['#422006', '#854D0E', '#FEF08A'],
  ['#1C0A0A', '#7F1D1D', '#FCA5A5'],
  ['#022C22', '#065F46', '#6EE7B7'],
  ['#0F172A', '#334155', '#E2E8F0'],
  ['#4A044E', '#701A75', '#FDE047'],
  ['#0F172A', '#312E81', '#A7F3D0'],
];

const SHAPES: CoverSpec['shape'][] = ['orb', 'rings', 'grid', 'wave', 'stripes'];

/** Generated artwork for tracks/playlists without a cover; the same seed always gives the same cover. */
export function coverSpec(seed: string, label: string): CoverSpec {
  const h = hashString(seed || label || '');
  const rng = mulberry32(h);
  const [a, b, accent] = COVER_PALETTES[h % COVER_PALETTES.length];
  const colors: [string, string, string] = rng() < 0.5 ? [a, b, accent] : [b, a, accent];
  return {
    colors,
    angle: Math.floor(rng() * 360),
    shape: SHAPES[Math.floor(rng() * SHAPES.length) % SHAPES.length],
    rotation: Math.floor(rng() * 24) * 15,
    initials: initials(label),
  };
}
