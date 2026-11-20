import { COVER_PALETTES, coverSpec } from '../covers';
import { contrast, isDark } from '../color';
import { initials } from '../text';

describe('coverSpec', () => {
  it('is deterministic per seed', () => {
    expect(coverSpec('playlist:42', 'Late Night Drive')).toEqual(coverSpec('playlist:42', 'Late Night Drive'));
    expect(coverSpec('', 'Late Night Drive')).toEqual(coverSpec('', 'Late Night Drive'));
  });

  it('varies across seeds within valid ranges', () => {
    const specs = Array.from({ length: 300 }, (_, i) => coverSpec(`seed-${i}`, 'Mix'));
    expect(new Set(specs.map((s) => s.colors.join())).size).toBeGreaterThanOrEqual(20);
    expect(new Set(specs.map((s) => s.shape)).size).toBe(5);
    for (const s of specs) {
      expect(s.angle).toBeGreaterThanOrEqual(0);
      expect(s.angle).toBeLessThan(360);
      expect(s.rotation % 15).toBe(0);
      expect(s.rotation).toBeLessThan(360);
      for (const c of s.colors) expect(c).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('takes initials from the label', () => {
    expect(coverSpec('x', 'Late Night Drive').initials).toBe('LN');
    expect(coverSpec('x', 'The Local Train').initials).toBe('LT');
    expect(coverSpec('x', 'আমার গান').initials).toBe(initials('আমার গান'));
    expect(coverSpec('x', '').initials).toBe('');
  });

  it('uses palettes that sit well on a near-black UI', () => {
    for (const [a, b, accent] of COVER_PALETTES) {
      expect(isDark(a)).toBe(true);
      expect(isDark(b)).toBe(true);
      expect(contrast(accent, '#09090B')).toBeGreaterThanOrEqual(7);
    }
  });
});
