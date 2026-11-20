import {
  ambientFrom,
  contrast,
  ensureContrast,
  hexToRgb,
  isDark,
  luminance,
  mix,
  pickAccent,
  rgbToHex,
  withAlpha,
} from '../color';
import type { Palette } from '../types';

const BG = '#09090B';
const palette = (p: Partial<Palette>): Palette => ({
  dominant: null,
  vibrant: null,
  darkVibrant: null,
  lightVibrant: null,
  muted: null,
  darkMuted: null,
  lightMuted: null,
  ...p,
});

function saturation(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  const max = Math.max(c.r, c.g, c.b) / 255;
  const min = Math.min(c.r, c.g, c.b) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

describe('hex helpers', () => {
  it('parses and formats', () => {
    expect(hexToRgb('#BEF264')).toEqual({ r: 190, g: 242, b: 100 });
    expect(hexToRgb('fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#09090B80')).toEqual({ r: 9, g: 9, b: 11 });
    expect(hexToRgb('#12345')).toBeNull();
    expect(hexToRgb('lime')).toBeNull();
    expect(rgbToHex(190, 242, 100)).toBe('#BEF264');
    expect(rgbToHex(300, -5, 127.6)).toBe('#FF0080');
  });

  it('mixes and adds alpha', () => {
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mix('#000000', '#FFFFFF', 2)).toBe('#FFFFFF');
    expect(mix('#BEF264', '#09090B', 0)).toBe('#BEF264');
    expect(withAlpha('#BEF264', 0.5)).toBe('rgba(190, 242, 100, 0.5)');
    expect(withAlpha('#fff', 2)).toBe('rgba(255, 255, 255, 1)');
  });
});

describe('contrast', () => {
  it('follows WCAG', () => {
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(luminance('#000000')).toBe(0);
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrast('#FFFFFF', '#777777')).toBeCloseTo(contrast('#777777', '#FFFFFF'), 9);
    expect(isDark(BG)).toBe(true);
    expect(isDark('#BEF264')).toBe(false);
  });

  it('lightens or darkens just enough, keeping the hue', () => {
    const purple = ensureContrast('#3B0764', BG);
    expect(contrast(purple, BG)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(purple, BG)).toBeLessThan(5);
    const rgb = hexToRgb(purple);
    expect(rgb && rgb.b > rgb.g && rgb.r > rgb.g).toBe(true);
    expect(ensureContrast('#BEF264', BG)).toBe('#BEF264');
    const onWhite = ensureContrast('#FDE68A', '#FFFFFF');
    expect(contrast(onWhite, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    expect(luminance(onWhite)).toBeLessThan(luminance('#FDE68A'));
    expect(contrast(ensureContrast('#9F1239', BG, 7), BG)).toBeGreaterThanOrEqual(7);
    expect(ensureContrast('not a colour', BG)).toBe('#FFFFFF');
  });
});

describe('pickAccent', () => {
  it('prefers the vibrant swatch and makes it readable', () => {
    const p = palette({ vibrant: '#7C3AED', lightVibrant: '#C4B5FD', dominant: '#1C1917', muted: '#78716C' });
    const accent = pickAccent(p, '#BEF264', BG);
    expect(contrast(accent, BG)).toBeGreaterThanOrEqual(3);
    const rgb = hexToRgb(accent);
    expect(rgb && rgb.b > rgb.r && rgb.r > rgb.g).toBe(true);
  });

  it('skips swatches that are too dark or grey and falls back', () => {
    const accent = pickAccent(palette({ vibrant: '#0A0310', lightVibrant: '#FDBA74', muted: '#777777' }), '#BEF264', BG);
    expect(hexToRgb(accent)).toEqual(hexToRgb('#FDBA74'));
    expect(pickAccent(palette({ muted: '#808080', dominant: '#222222' }), '#BEF264', BG)).toBe('#BEF264');
    expect(pickAccent(null, '#BEF264', BG)).toBe('#BEF264');
    expect(contrast(pickAccent(undefined, '#3B0764', BG), BG)).toBeGreaterThanOrEqual(3);
  });
});

describe('ambientFrom', () => {
  it('builds dark, muted stops that keep white text readable', () => {
    const p = palette({ vibrant: '#F43F5E', darkVibrant: '#9F1239', dominant: '#FB7185' });
    const a = ambientFrom(p, '#BEF264');
    for (const c of [a.top, a.mid, a.bottom]) {
      expect(contrast('#FFFFFF', c)).toBeGreaterThanOrEqual(4.5);
      expect(isDark(c)).toBe(true);
      expect(saturation(c)).toBeLessThanOrEqual(0.56);
    }
    expect(luminance(a.bottom)).toBeLessThanOrEqual(luminance(a.mid));
    expect(a.glow).toMatch(/^rgba\(\d+, \d+, \d+, 0\.35\)$/);
  });

  it('works without a palette', () => {
    const a = ambientFrom(null, '#BEF264');
    expect(contrast('#FFFFFF', a.top)).toBeGreaterThanOrEqual(4.5);
    expect(a.glow.startsWith('rgba(')).toBe(true);
    expect(ambientFrom(palette({}), 'bogus').top).toMatch(/^#[0-9A-F]{6}$/);
  });
});
