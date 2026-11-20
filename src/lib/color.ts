import type { Palette } from './types';

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Accepts "#RGB", "#RRGGBB" and "#RRGGBBAA" (alpha ignored), with or without the '#'. */
export function hexToRgb(hex: string): RGB | null {
  if (typeof hex !== 'string') return null;
  let h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(h)) return null;
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 255))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function toHex(c: RGB): string {
  return rgbToHex(c.r, c.g, c.b);
}

/** Linear blend in sRGB; t = 0 gives `a`, t = 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  if (!ca || !cb) return toHex(ca ?? cb ?? { r: 0, g: 0, b: 0 });
  const k = clamp(Number.isFinite(t) ? t : 0, 0, 1);
  return rgbToHex(ca.r + (cb.r - ca.r) * k, ca.g + (cb.g - ca.g) * k, ca.b + (cb.b - ca.b) * k);
}

/** "rgba(r, g, b, a)". */
export function withAlpha(hex: string, a: number): string {
  const c = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  const alpha = Math.round(clamp(Number.isFinite(a) ? a : 1, 0, 1) * 1000) / 1000;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance, 0 (black)..1 (white). */
export function luminance(hex: string): number {
  const c = hexToRgb(hex);
  if (!c) return 0;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Dark enough that white text reads better than black. */
export function isDark(hex: string): boolean {
  return luminance(hex) < 0.179;
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s: clamp(s, 0, 1), l };
}

function hslToHex({ h, s, l }: HSL): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function hsl(hex: string): HSL | null {
  const c = hexToRgb(hex);
  return c ? rgbToHsl(c) : null;
}

/**
 * Moves `fg`'s HSL lightness toward white (on dark backgrounds) or black (on light ones) just
 * far enough to reach `min` contrast against `bg`. Hue and saturation are kept.
 */
export function ensureContrast(fg: string, bg: string, min = 4.5): string {
  const rgb = hexToRgb(fg);
  if (!rgb) return isDark(bg) ? '#FFFFFF' : '#000000';
  const norm = toHex(rgb);
  if (contrast(norm, bg) >= min) return norm;
  const c = rgbToHsl(rgb);
  const up = isDark(bg);
  const target = up ? '#FFFFFF' : '#000000';
  if (contrast(target, bg) < min) return contrast('#FFFFFF', bg) >= contrast('#000000', bg) ? '#FFFFFF' : '#000000';
  let lo = c.l;
  let hi = up ? 1 : 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrast(hslToHex({ ...c, l: mid }), bg) >= min) hi = mid;
    else lo = mid;
  }
  const out = hslToHex({ ...c, l: hi });
  return contrast(out, bg) >= min ? out : target;
}

/** Artwork accent for buttons and progress: the most vibrant usable swatch, readable on `bg`. */
export function pickAccent(p: Palette | null | undefined, fallback: string, bg: string): string {
  if (p) {
    for (const sw of [p.vibrant, p.lightVibrant, p.dominant, p.muted]) {
      const c = sw ? hsl(sw) : null;
      if (c && c.s >= 0.25 && c.l >= 0.12 && c.l <= 0.92) return ensureContrast(hslToHex(c), bg, 3);
    }
  }
  return ensureContrast(fallback, bg, 3);
}

/**
 * Full-screen gradient stops from the artwork: dark, desaturated colours that keep white text
 * readable (>= 4.5:1), plus a translucent glow in the brighter accent.
 */
export function ambientFrom(
  p: Palette | null | undefined,
  fallback: string,
): { top: string; mid: string; bottom: string; glow: string } {
  const baseHex =
    [p?.darkVibrant, p?.vibrant, p?.dominant, p?.darkMuted, p?.muted].find((c) => c && hexToRgb(c)) ?? fallback;
  const base = hsl(baseHex) ?? hsl(fallback) ?? { h: 0, s: 0, l: 0.2 };
  const sat = Math.min(base.s, 0.55);
  const top = ensureContrast(hslToHex({ h: base.h, s: sat * 0.9, l: clamp(base.l, 0.2, 0.3) }), '#FFFFFF', 4.5);
  const mid = ensureContrast(hslToHex({ h: base.h, s: sat * 0.75, l: 0.13 }), '#FFFFFF', 4.5);
  const bottom = mix(mid, '#09090B', 0.75);
  const glowHex = [p?.vibrant, p?.lightVibrant, p?.dominant].find((c) => c && hexToRgb(c)) ?? baseHex;
  const g = hsl(glowHex) ?? base;
  const glow = withAlpha(hslToHex({ h: g.h, s: clamp(g.s, 0.35, 0.9), l: clamp(g.l, 0.5, 0.65) }), 0.35);
  return { top, mid, bottom, glow };
}
