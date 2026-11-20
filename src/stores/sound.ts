import { create } from 'zustand';

import { read, ThrumAudio, type AudioRoute, type RouteEvent, type SoundState } from '@/audio/native';
import { applyPreset, sanitizeSound, THRUM_SOUND } from '@/lib/eq';
import type { SoundParams, SoundPreset } from '@/lib/types';

type SoundStore = {
  ready: boolean;
  params: SoundParams;
  route: AudioRoute;
  perDevice: boolean;
  profiles: Record<string, SoundParams>;
  /** Preamp cut the engine applies so boosts can't clip (<= 0 dB). */
  headroomDb: number;
  /** Hold-to-compare: the original signal while true. */
  bypass: boolean;
};

const SPEAKER: AudioRoute = { kind: 'speaker', name: 'Phone speaker', key: 'speaker' };

export const useSound = create<SoundStore>()(() => ({
  ready: false,
  params: THRUM_SOUND,
  route: SPEAKER,
  perDevice: true,
  profiles: {},
  headroomDb: 0,
  bypass: false,
}));

let pending: SoundParams | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSent = 0;
const THROTTLE_MS = 30;

function apply(s: SoundState) {
  useSound.setState({
    ready: true,
    params: sanitizeSound(s.params, THRUM_SOUND),
    route: s.route ?? SPEAKER,
    perDevice: s.perDevice,
    profiles: s.profiles ?? {},
    headroomDb: Number.isFinite(s.headroomDb) ? s.headroomDb : 0,
    bypass: s.bypass,
  });
}

export function hydrateSound() {
  const s = read(() => ThrumAudio.getSoundState(), null);
  if (s) apply(s);
}

export function onRouteEvent(e: RouteEvent) {
  // The new device brings its own profile; a drag still in flight belongs to the old one.
  pending = null;
  apply(e.sound);
}

function flush() {
  timer = null;
  const p = pending;
  if (!p) return;
  pending = null;
  lastSent = Date.now();
  const s = read(() => ThrumAudio.setSound(p), null);
  if (s) useSound.setState({ headroomDb: s.headroomDb, profiles: s.profiles ?? {} });
}

/** Updates the UI at once and the engine at most every 30 ms (with a trailing write), so drags stay fluid. */
export function updateSound(change: Partial<SoundParams> | ((p: SoundParams) => Partial<SoundParams>)) {
  const prev = useSound.getState().params;
  const patch = typeof change === 'function' ? change(prev) : change;
  const params = sanitizeSound({ ...prev, ...patch }, prev);
  useSound.setState({ params });
  pending = params;
  const wait = THROTTLE_MS - (Date.now() - lastSent);
  if (wait <= 0) {
    if (timer) clearTimeout(timer);
    flush();
  } else {
    timer ??= setTimeout(flush, wait);
  }
}

export function setBand(index: number, db: number) {
  updateSound((p) => {
    const bands = p.bands.slice();
    bands[index] = Math.round(db * 10) / 10;
    return { bands };
  });
}

export function applySoundPreset(preset: SoundPreset) {
  updateSound((p) => applyPreset(p, preset));
}

export function resetSound() {
  updateSound(THRUM_SOUND);
}

export function setPerDevice(enabled: boolean) {
  const s = read(() => ThrumAudio.setPerDevice(enabled), null);
  if (s) apply(s);
  else useSound.setState({ perDevice: enabled });
}

export function setBypass(bypass: boolean) {
  if (useSound.getState().bypass === bypass) return;
  useSound.setState({ bypass });
  const s = read(() => ThrumAudio.setBypass(bypass), null);
  if (s) useSound.setState({ bypass: s.bypass, headroomDb: s.headroomDb });
}
