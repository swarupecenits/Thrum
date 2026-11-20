export type ThemeId = 'ink' | 'amoled';
export type AccentId = 'lime' | 'adaptive' | 'violet' | 'coral' | 'sky' | 'amber' | 'mint';

export type AccentSwatch = { id: Exclude<AccentId, 'adaptive'>; label: string; color: string; on: string };

/** Fixed accents. "adaptive" borrows a colour from the artwork that's playing (see stores/now). */
export const ACCENTS: readonly AccentSwatch[] = [
  { id: 'lime', label: 'Lime', color: '#BEF264', on: '#0B0F04' },
  { id: 'violet', label: 'Ultraviolet', color: '#A78BFA', on: '#0E0A1F' },
  { id: 'coral', label: 'Coral', color: '#FB7185', on: '#1F0A0E' },
  { id: 'sky', label: 'Sky', color: '#7DD3FC', on: '#04131C' },
  { id: 'amber', label: 'Amber', color: '#FCD34D', on: '#1C1403' },
  { id: 'mint', label: 'Mint', color: '#6EE7B7', on: '#03170F' },
];

export const LIME = ACCENTS[0];

export type Palette = {
  theme: ThemeId;
  bg: string;
  surface: string;
  surface2: string;
  raised: string;
  ink: string;
  ink2: string;
  ink3: string;
  ink4: string;
  line: string;
  lineStrong: string;
  /** Translucent fill for pills, inputs and pressed rows. */
  fill: string;
  fillStrong: string;
  accent: string;
  onAccent: string;
  danger: string;
  scrim: string;
  /** The indigo bloom from the portfolio, used sparingly behind hero moments. */
  glow: string;
};

const ink: Omit<Palette, 'accent' | 'onAccent'> = {
  theme: 'ink',
  bg: '#09090B',
  surface: '#121215',
  surface2: '#18181C',
  raised: '#1E1E23',
  ink: '#FAFAFA',
  ink2: '#D4D4D8',
  ink3: '#A1A1AA',
  ink4: '#71717A',
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
  fill: 'rgba(255,255,255,0.06)',
  fillStrong: 'rgba(255,255,255,0.11)',
  danger: '#F87171',
  scrim: 'rgba(0,0,0,0.62)',
  glow: 'rgb(129,140,248)',
};

const amoled: Omit<Palette, 'accent' | 'onAccent'> = {
  ...ink,
  theme: 'amoled',
  bg: '#000000',
  surface: '#0B0B0D',
  surface2: '#121215',
  raised: '#18181C',
  scrim: 'rgba(0,0,0,0.72)',
};

export const bases: Record<ThemeId, Omit<Palette, 'accent' | 'onAccent'>> = { ink, amoled };

export function makePalette(theme: ThemeId, accent: string, onAccent: string): Palette {
  return { ...bases[theme], accent, onAccent };
}
