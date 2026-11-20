/** cyrb53 folded to an unsigned 32-bit integer. Stable across platforms. */
export function hashString(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Small, fast seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = (Number.isFinite(seed) ? seed : 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded RNG from any string, e.g. `rngFrom('daylist|2026-11-20|evening')`. */
export function rngFrom(key: string): () => number {
  return mulberry32(hashString(key));
}

/**
 * Picks one item with probability proportional to `weight`. Non-finite or negative weights count as 0.
 * Returns undefined when no item has a positive weight.
 */
export function pickWeighted<T>(items: T[], weight: (t: T) => number, rng: () => number): T | undefined {
  const weights = new Array<number>(items.length);
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const w = weight(items[i]);
    const safe = Number.isFinite(w) && w > 0 ? w : 0;
    weights[i] = safe;
    total += safe;
  }
  if (total <= 0) return undefined;
  let r = rng() * total;
  let last = -1;
  for (let i = 0; i < items.length; i++) {
    if (weights[i] <= 0) continue;
    last = i;
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return last >= 0 ? items[last] : undefined;
}
