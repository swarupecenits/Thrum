import { cancelAnimation, Easing, makeMutable, withTiming } from 'react-native-reanimated';

/**
 * Playback position for the UI thread. Between native syncs it advances on its own as a linear
 * timing animation, so seek bars and lyrics move every frame without the JS thread ticking them.
 */
export const positionMs = makeMutable(0);
export const durationMs = makeMutable(0);

let base = 0;
let baseAt = 0;
let rate = 0;
let dur = 0;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function syncClock(pos: number, duration: number, playing: boolean, speed: number) {
  dur = Math.max(0, Number.isFinite(duration) ? duration : 0);
  base = clamp(Number.isFinite(pos) ? pos : 0, 0, dur > 0 ? dur : Number.MAX_SAFE_INTEGER);
  baseAt = Date.now();
  rate = playing ? Math.max(0.1, speed || 1) : 0;
  durationMs.set(dur);
  cancelAnimation(positionMs);
  positionMs.set(base);
  if (rate > 0 && dur > base) {
    positionMs.set(withTiming(dur, { duration: (dur - base) / rate, easing: Easing.linear }));
  }
}

/**
 * Best guess of the current position on the JS thread. Components pass their clock tick as `at`,
 * so memoizing compilers see a changing input.
 */
export function estimatePosition(at: number = Date.now()): number {
  const p = base + (at - baseAt) * rate;
  return dur > 0 ? Math.min(p, dur) : p;
}

export function clockRunning(): boolean {
  return rate > 0;
}
