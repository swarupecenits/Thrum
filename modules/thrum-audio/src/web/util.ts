/** Monotonic milliseconds; playback time never follows wall-clock jumps. */
export const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Finite number, else the fallback. */
export const finite = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** Truncated like the native bridge converts JS numbers to Int/Long. */
export const int = (v: unknown, fallback: number): number => Math.trunc(finite(v, fallback));

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const round = (x: number, digits: number): number => {
  const k = 10 ** digits;
  const r = Math.round(x * k) / k;
  return r === 0 ? 0 : r;
};

export const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Gaussian bump, 1 at `centre`. */
export const bump = (x: number, centre: number, width: number): number => {
  const d = (x - centre) / width;
  return Math.exp(-d * d);
};

/** Integer hash of two ints to [0, 1), allocation-free. */
export const hash01 = (a: number, b: number): number => {
  let h = Math.imul(a ^ Math.imul(b, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
