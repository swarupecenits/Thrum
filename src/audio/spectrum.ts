import { useEffect } from 'react';
import { AppState } from 'react-native';
import { makeMutable } from 'react-native-reanimated';

import { read, ThrumAudio } from './native';

export const SPECTRUM_BANDS = 48;

/** Live analyser output for visuals; 0..1 per band, smoothed like a meter (fast rise, slow fall). */
export const spectrumBands = makeMutable<number[]>(new Array<number>(SPECTRUM_BANDS).fill(0));
/** Kick/bass pulse 0..1 for the breathing artwork. */
export const bassPulse = makeMutable(0);
export const peakDb = makeMutable(-96);
/** Limiter gain reduction in dB. */
export const reductionDb = makeMutable(0);

const smooth = new Array<number>(SPECTRUM_BANDS).fill(0);
let smoothBass = 0;
let smoothReduction = 0;

let users = 0;
let playing = false;
let foreground = AppState.currentState !== 'background';
let frame: number | null = null;
let last = 0;
let idleFrames = 0;

const RISE = 0.55;
const FALL = 0.82;

function step(target: number[] | null, bassTarget: number, peak: number, reduction: number) {
  let energy = 0;
  for (let i = 0; i < SPECTRUM_BANDS; i++) {
    const v = target ? Math.max(0, Math.min(1, target[i] ?? 0)) : 0;
    const s = smooth[i];
    smooth[i] = v > s ? s + (v - s) * RISE : s * FALL + v * (1 - FALL);
    if (smooth[i] < 0.002) smooth[i] = 0;
    energy += smooth[i];
  }
  const b = Math.max(0, Math.min(1, bassTarget));
  smoothBass = b > smoothBass ? smoothBass + (b - smoothBass) * 0.7 : smoothBass * 0.86 + b * 0.14;
  if (smoothBass < 0.002) smoothBass = 0;
  smoothReduction = reduction > smoothReduction ? reduction : smoothReduction * 0.9 + reduction * 0.1;
  spectrumBands.set(smooth.slice());
  bassPulse.set(smoothBass);
  peakDb.set(peak);
  reductionDb.set(smoothReduction);
  return energy + smoothBass;
}

function tick(ts: number) {
  frame = null;
  if (!shouldRun()) {
    // Let the meters fall to rest instead of freezing mid-air.
    if (step(null, 0, -96, 0) > 0.01 && idleFrames++ < 90) frame = requestAnimationFrame(tick);
    return;
  }
  frame = requestAnimationFrame(tick);
  // High refresh-rate screens fire rAF at 90-120 Hz; 60 updates a second is plenty.
  if (ts - last < 15) return;
  last = ts;
  const s = read(() => ThrumAudio.getSpectrum(), null);
  if (s) step(s.bands, s.bass, s.peakDb, s.reductionDb);
  else step(null, 0, -96, 0);
}

function shouldRun() {
  return users > 0 && playing && foreground;
}

function kick() {
  idleFrames = 0;
  if (frame === null) frame = requestAnimationFrame(tick);
}

export function setSpectrumPlaying(next: boolean) {
  if (next === playing) return;
  playing = next;
  kick();
}

AppState.addEventListener('change', (state) => {
  foreground = state !== 'background';
  kick();
});

/** Keeps the analyser polling while a visualiser is on screen. */
export function useSpectrum(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    users += 1;
    kick();
    return () => {
      users -= 1;
      kick();
    };
  }, [enabled]);
}
