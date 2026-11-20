import { curveDb, logFreqs, sanitizeSound, THRUM_SOUND } from '../../../../src/lib/eq';
import type { AudioRoute, RouteKind, SoundParams, SoundState } from '../ThrumAudio.types';
import { isRecord } from './util';

/** The output the web demo pretends to be playing through. */
export const DEMO_ROUTE: AudioRoute = {
  kind: 'bluetooth',
  name: 'Galaxy Buds3 Pro',
  key: 'bluetooth:Galaxy Buds3 Pro',
};

/** RouteMonitor.describe: how native names and keys each kind of output. */
export function routeOf(kind: RouteKind, name?: string): AudioRoute {
  const product = typeof name === 'string' ? name.trim() : '';
  switch (kind) {
    case 'bluetooth': {
      const n = product || 'Bluetooth';
      return { kind, name: n, key: `bluetooth:${n}` };
    }
    case 'usb': {
      const n = product || 'USB audio';
      return { kind, name: n, key: `usb:${n}` };
    }
    case 'wired':
      return { kind, name: 'Wired headphones', key: 'wired' };
    case 'other': {
      const n = product || 'External output';
      return { kind, name: n, key: `other:${n}` };
    }
    default:
      return { kind: 'speaker', name: 'Phone speaker', key: 'speaker' };
  }
}

// Same grid as EqLayout.maxBoostDb: 241 log-spaced points, 20 Hz..20 kHz.
const HEADROOM_FREQS = logFreqs(241, 20, 20000);

/** DspEngine.headroomFor: -0.75x the largest boost, phantom bass counting 1.5 dB per unit, 0.1 dB steps. */
function headroomFor(p: SoundParams): number {
  if (!p.autoHeadroom) return 0;
  const boost = Math.max(0, ...curveDb(p, HEADROOM_FREQS)) + 1.5 * p.phantom;
  const db = Math.round(-0.75 * Math.max(0, boost) * 10) / 10;
  return db === 0 ? 0 : db;
}

const copy = (p: SoundParams): SoundParams => ({ ...p, bands: [...p.bands] });

/** In-memory SoundCenter: current params, per-device profiles and bypass. Nothing is persisted. */
export class SoundSim {
  params: SoundParams = copy(THRUM_SOUND);
  route: AudioRoute = { ...DEMO_ROUTE };
  bypass = false;
  /** Automatic headroom of `params`, applied when the engine is enabled. */
  headroom = headroomFor(this.params);
  /** Bumped whenever what the engine applies changes, so the spectrum knows to refresh its curve. */
  version = 0;
  private latest: SoundParams = copy(THRUM_SOUND);
  private perDevice = true;
  private readonly profiles = new Map<string, SoundParams>();

  state(): SoundState {
    const profiles: Record<string, SoundParams> = {};
    this.profiles.forEach((p, key) => {
      profiles[key] = copy(p);
    });
    return {
      params: copy(this.params),
      route: { ...this.route },
      perDevice: this.perDevice,
      profiles,
      headroomDb: this.params.enabled ? this.headroom : 0,
      bypass: this.bypass,
    };
  }

  set(input: unknown): SoundState {
    const next = sanitizeSound(isRecord(input) ? (input as Partial<SoundParams>) : null, this.params);
    this.apply(next);
    this.latest = copy(next);
    if (this.perDevice) this.profiles.set(this.route.key, copy(next));
    return this.state();
  }

  setPerDevice(enabled: boolean): SoundState {
    if (enabled !== this.perDevice) {
      this.perDevice = enabled;
      if (enabled) this.profiles.set(this.route.key, copy(this.params));
      else this.latest = copy(this.params);
    }
    return this.state();
  }

  setBypass(bypass: boolean): SoundState {
    if (bypass !== this.bypass) {
      this.bypass = bypass;
      this.version++;
    }
    return this.state();
  }

  /** SoundCenter.onRouteChanged: per-device mode loads the new output's profile (or the last edit). */
  routeChanged(route: AudioRoute): SoundState {
    this.route = { ...route };
    if (this.perDevice) this.apply(copy(this.profiles.get(route.key) ?? this.latest));
    return this.state();
  }

  private apply(p: SoundParams): void {
    this.params = p;
    this.headroom = headroomFor(p);
    this.version++;
  }
}
