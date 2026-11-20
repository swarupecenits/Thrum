import { hashString, mulberry32, pickWeighted, rngFrom } from '../random';

describe('hashString', () => {
  it('is a deterministic unsigned 32-bit hash', () => {
    const h = hashString('Tum Hi Ho');
    expect(hashString('Tum Hi Ho')).toBe(h);
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(2 ** 32);
    expect(hashString('Tum Hi Ho ')).not.toBe(h);
    expect(Number.isInteger(hashString(''))).toBe(true);
  });

  it('spreads similar keys', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(hashString(`track-${i}`));
    expect(seen.size).toBe(1000);
  });
});

describe('mulberry32', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(Array.from({ length: 5 }, c)).not.toEqual(seqA);
    expect(Array.from({ length: 3 }, rngFrom('daylist'))).toEqual(Array.from({ length: 3 }, rngFrom('daylist')));
  });

  it('produces roughly uniform floats in [0, 1)', () => {
    const rng = mulberry32(7);
    let sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const x = rng();
      expect(x >= 0 && x < 1).toBe(true);
      sum += x;
    }
    expect(sum / 10_000).toBeCloseTo(0.5, 1);
    expect(Number.isFinite(mulberry32(Number.NaN)())).toBe(true);
  });
});

describe('pickWeighted', () => {
  it('picks in proportion to weight and skips zero weights', () => {
    const rng = mulberry32(1);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    const weights: Record<string, number> = { a: 1, b: 3, c: 0 };
    for (let i = 0; i < 4000; i++) {
      const k = pickWeighted(['a', 'b', 'c'], (x) => weights[x], rng);
      if (k) counts[k]++;
    }
    expect(counts.c).toBe(0);
    expect(counts.b / counts.a).toBeGreaterThan(2.5);
    expect(counts.b / counts.a).toBeLessThan(3.5);
  });

  it('returns undefined when nothing can be picked', () => {
    const rng = mulberry32(1);
    expect(pickWeighted([], () => 1, rng)).toBeUndefined();
    expect(pickWeighted([1, 2], () => 0, rng)).toBeUndefined();
    expect(pickWeighted([1, 2], () => Number.NaN, rng)).toBeUndefined();
    expect(pickWeighted([1, 2], (x) => (x === 2 ? 5 : -1), rng)).toBe(2);
    expect(pickWeighted(['only'], () => 1, () => 0.999999)).toBe('only');
  });
});
