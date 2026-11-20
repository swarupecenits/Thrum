import type { SoundParams, SoundPreset } from './types';

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_Q = 1.41;
export const TREBLE_FREQ = 7000;
export const BASS_FREQ_RANGE: [number, number] = [40, 150];
export const RUMBLE_FREQ = 25;
/** Q of the two sections of a 4th-order Butterworth high-pass. */
export const RUMBLE_Q: [number, number] = [0.5412, 1.3066];

export const FLAT_SOUND: SoundParams = {
  enabled: true,
  preampDb: 0,
  autoHeadroom: true,
  bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bassDb: 0,
  bassFreq: 80,
  phantom: 0,
  rumble: true,
  trebleDb: 0,
  width: 1,
  balance: 0,
  limiter: true,
};

/** First-run signature: a warm sub lift, clean mids and a touch of air. */
export const THRUM_SOUND: SoundParams = {
  ...FLAT_SOUND,
  bands: [2.5, 2, 0.5, 0, 0, 0, 0, 0.5, 1, 1.5],
  bassDb: 4,
  bassFreq: 80,
  phantom: 0.15,
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

function num(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/** Clamps every field to the engine's limits; missing or NaN values come from `base`. */
export function sanitizeSound(p: Partial<SoundParams> | null | undefined, base: SoundParams = FLAT_SOUND): SoundParams {
  const src = p ?? {};
  const bands = Array.isArray(src.bands) ? src.bands : [];
  return {
    enabled: bool(src.enabled, base.enabled),
    preampDb: num(src.preampDb, -12, 6, base.preampDb),
    autoHeadroom: bool(src.autoHeadroom, base.autoHeadroom),
    bands: EQ_BANDS.map((_, i) => num(bands[i], -12, 12, num(base.bands[i], -12, 12, 0))),
    bassDb: num(src.bassDb, 0, 12, base.bassDb),
    bassFreq: num(src.bassFreq, BASS_FREQ_RANGE[0], BASS_FREQ_RANGE[1], base.bassFreq),
    phantom: num(src.phantom, 0, 1, base.phantom),
    rumble: bool(src.rumble, base.rumble),
    trebleDb: num(src.trebleDb, -6, 6, base.trebleDb),
    width: num(src.width, 0, 2, base.width),
    balance: num(src.balance, -1, 1, base.balance),
    limiter: bool(src.limiter, base.limiter),
  };
}

const preset = (id: string, name: string, blurb: string, params: Partial<SoundParams>): SoundPreset => ({
  id,
  name,
  blurb,
  params,
});

export const PRESETS: SoundPreset[] = [
  preset('flat', 'Flat', 'Exactly as the record was mastered.', {}),
  preset('thrum', 'Thrum', 'Our signature: warm sub, clean mids, a little air.', {
    bands: THRUM_SOUND.bands,
    bassDb: 4,
    bassFreq: 80,
    phantom: 0.15,
  }),
  preset('bass-head', 'Bass Head', 'Maximum low end. Feel every kick in your chest.', {
    bands: [8, 6.5, 3.5, 0.5, -1, -1, 0, 0.5, 1, 0.5],
    bassDb: 6,
    bassFreq: 90,
    phantom: 0.5,
  }),
  preset('deep-bass', 'Deep Bass', 'Sub-focused weight below 60 Hz, mids left alone.', {
    bands: [6, 4.5, 1, 0, 0, 0, 0, 0, 0.5, 0.5],
    bassDb: 3,
    bassFreq: 60,
    phantom: 0.2,
    rumble: true,
  }),
  preset('bass-treble', 'Bass & Treble', 'The classic V: punchy lows, crisp highs.', {
    bands: [5, 4, 2, 0, -1.5, -2, -1, 1, 3, 4],
    bassDb: 2,
    trebleDb: 2,
    phantom: 0.15,
  }),
  preset('warm', 'Warm', 'Rounded lows and softened highs, like vinyl on a good system.', {
    bands: [3, 2.5, 2, 1.5, 0.5, 0, -0.5, -1, -1.5, -2],
    bassDb: 1.5,
    bassFreq: 100,
  }),
  preset('vocal', 'Vocal / Clarity', 'Voices step forward and the mud clears out.', {
    bands: [-1.5, -1, -1, -1.5, 0, 1.5, 3, 3, 1.5, 0.5],
  }),
  preset('bollywood', 'Bollywood', 'Warm low-mids, vocal presence and sparkle on the strings.', {
    bands: [2, 2, 1.5, 1, 0, 1, 2.5, 2, 2, 2.5],
    bassDb: 1.5,
    bassFreq: 90,
  }),
  preset('punjabi', 'Punjabi / Bhangra', 'Dhol kick up front, tumbi and vocals bright.', {
    bands: [2.5, 5, 4, 0.5, -1, 0, 1.5, 3, 3, 2.5],
    bassDb: 2,
    bassFreq: 100,
    trebleDb: 1,
    phantom: 0.25,
  }),
  preset('lofi', 'Lo-fi', 'Soft highs and warm mids for dusty, late-night beats.', {
    bands: [2, 2, 1.5, 1.5, 1, 0, -1, -2, -3, -4],
    bassDb: 1,
  }),
  preset('edm', 'EDM', 'Big kick, tight sub and bright synth leads.', {
    bands: [5, 4.5, 1.5, 0, -1, -1, 0, 1.5, 3, 3.5],
    bassDb: 3,
    bassFreq: 70,
    phantom: 0.25,
  }),
  preset('hiphop', 'Hip-hop / Trap', '808 sub weight with vocals that cut through.', {
    bands: [6, 5, 2, 0, -1, -0.5, 1, 1.5, 1, 1],
    bassDb: 4,
    bassFreq: 60,
    phantom: 0.35,
  }),
  preset('acoustic', 'Acoustic', 'Natural body, string detail and honest highs.', {
    bands: [1, 1, 1.5, 1, 0, 0.5, 1.5, 2, 1.5, 1],
  }),
  preset('classical', 'Classical', 'Gentle and open; lets the dynamics breathe.', {
    bands: [1, 0.5, 0, 0, 0, 0, 0, 0.5, 1, 1.5],
    width: 1.1,
  }),
  preset('late-night', 'Late Night', 'A loudness contour for low volumes: fuller lows and highs.', {
    bands: [4, 3.5, 2, 0.5, 0, 0, 0, 1, 2, 2.5],
    bassDb: 2,
    phantom: 0.2,
  }),
  preset('podcast', 'Podcast / Spoken', 'Clear speech, less boom, no hiss.', {
    bands: [-6, -4, -2, 0, 1, 2.5, 3, 2, 0, -1.5],
  }),
  preset('small-speaker', 'Small Speaker', 'Phantom bass for phones and tiny drivers that cannot move air.', {
    bands: [-2, 0, 3, 2, 0, 0, 0.5, 1, 1, 0],
    bassDb: 3,
    bassFreq: 120,
    phantom: 0.8,
    rumble: true,
  }),
  preset('car', 'Car', 'Fills the cabin: tuned lows, road-noise mids tamed, clear top.', {
    bands: [3, 3, 1.5, -0.5, -1, 0, 1, 2, 2, 1.5],
    bassDb: 2,
    phantom: 0.1,
  }),
];

const KEEP_KEYS = ['enabled', 'width', 'balance', 'limiter'] as const;

/** Tone settings come from the preset (or Flat); output settings are kept unless the preset sets them. */
export function applyPreset(base: SoundParams, p: SoundPreset): SoundParams {
  const merged: SoundParams = { ...FLAT_SOUND, ...p.params };
  for (const k of KEEP_KEYS) {
    if (p.params[k] === undefined) Object.assign(merged, { [k]: base[k] });
  }
  return sanitizeSound(merged, FLAT_SOUND);
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.05;

/** Id of the preset whose tone matches `p`, or null for a custom sound. */
export function matchPreset(p: SoundParams): string | null {
  const s = sanitizeSound(p);
  for (const pr of PRESETS) {
    const t = applyPreset(s, pr);
    if (!t.bands.every((b, i) => near(b, s.bands[i]))) continue;
    if (!near(t.bassDb, s.bassDb) || !near(t.trebleDb, s.trebleDb) || !near(t.phantom, s.phantom)) continue;
    if (t.bassDb > 0 && !near(t.bassFreq, s.bassFreq)) continue;
    return pr.id;
  }
  return null;
}

/** `n` log-spaced frequencies from lo to hi inclusive. */
export function logFreqs(n: number, lo = 20, hi = 20000): number[] {
  if (!(n >= 1)) return [];
  if (n === 1) return [lo];
  const ratio = Math.log(hi / lo);
  return Array.from({ length: Math.floor(n) }, (_, i) => lo * Math.exp((ratio * i) / (Math.floor(n) - 1)));
}

type Biquad = [number, number, number, number, number, number];

function peaking(f0: number, db: number, q: number, fs: number): Biquad {
  const A = 10 ** (db / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return [1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A];
}

function lowShelf(f0: number, db: number, fs: number): Biquad {
  const A = 10 ** (db / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2;
  const c = Math.cos(w0);
  const s = 2 * Math.sqrt(A) * alpha;
  return [
    A * (A + 1 - (A - 1) * c + s),
    2 * A * (A - 1 - (A + 1) * c),
    A * (A + 1 - (A - 1) * c - s),
    A + 1 + (A - 1) * c + s,
    -2 * (A - 1 + (A + 1) * c),
    A + 1 + (A - 1) * c - s,
  ];
}

function highShelf(f0: number, db: number, fs: number): Biquad {
  const A = 10 ** (db / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = (Math.sin(w0) / 2) * Math.SQRT2;
  const c = Math.cos(w0);
  const s = 2 * Math.sqrt(A) * alpha;
  return [
    A * (A + 1 + (A - 1) * c + s),
    -2 * A * (A - 1 + (A + 1) * c),
    A * (A + 1 + (A - 1) * c - s),
    A + 1 - (A - 1) * c + s,
    2 * (A - 1 - (A + 1) * c),
    A + 1 - (A - 1) * c - s,
  ];
}

function highPass(f0: number, q: number, fs: number): Biquad {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha];
}

/** |H(e^jw)| in dB, evaluated analytically. */
function magnitudeDb([b0, b1, b2, a0, a1, a2]: Biquad, w: number): number {
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const nr = b0 + b1 * c1 + b2 * c2;
  const ni = b1 * s1 + b2 * s2;
  const dr = a0 + a1 * c1 + a2 * c2;
  const di = a1 * s1 + a2 * s2;
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The filter chain the native engine runs, in order: rumble HPF, bass shelf, 10 peaking bands, treble shelf. */
function chain(p: SoundParams, fs: number): Biquad[] {
  const s = sanitizeSound(p);
  const nyquistGuard = 0.45 * fs;
  const out: Biquad[] = [];
  if (s.rumble) for (const q of RUMBLE_Q) out.push(highPass(RUMBLE_FREQ, q, fs));
  if (s.bassDb !== 0 && s.bassFreq < nyquistGuard) out.push(lowShelf(s.bassFreq, s.bassDb, fs));
  EQ_BANDS.forEach((f0, i) => {
    if (s.bands[i] !== 0 && f0 < nyquistGuard) out.push(peaking(f0, s.bands[i], BAND_Q, fs));
  });
  if (s.trebleDb !== 0 && TREBLE_FREQ < nyquistGuard) out.push(highShelf(TREBLE_FREQ, s.trebleDb, fs));
  return out;
}

/**
 * Magnitude response (dB) of the tone filters at each frequency, excluding preamp and headroom.
 * `enabled` is ignored so the editor can still draw a bypassed curve.
 */
export function curveDb(p: SoundParams, freqs: number[], fs = 48000): number[] {
  const filters = chain(p, fs);
  return freqs.map((f) => {
    const w = (2 * Math.PI * f) / fs;
    let db = 0;
    for (const bq of filters) db += magnitudeDb(bq, w);
    return db === 0 ? 0 : db;
  });
}

const HEADROOM_FREQS = logFreqs(64, 20, 20000);

/**
 * Automatic preamp cut: 0.75x the largest boost (max 12 dB), plus up to 2 dB for phantom bass harmonics.
 * Rounded to 0.1 dB like the engine, which also hides the micro-dB ripple of the rumble filter.
 */
export function autoHeadroomDb(p: SoundParams): number {
  if (!p.autoHeadroom) return 0;
  const peak = Math.max(0, ...curveDb(p, HEADROOM_FREQS, 48000));
  const db = clamp(-0.75 * peak, -12, 0) - 2 * clamp(Number.isFinite(p.phantom) ? p.phantom : 0, 0, 1);
  const rounded = Math.round(db * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** What the listener hears relative to the input: curve + preamp + automatic headroom. */
export function responseDb(p: SoundParams, freqs: number[], fs = 48000): number[] {
  const offset = sanitizeSound(p).preampDb + autoHeadroomDb(p);
  return curveDb(p, freqs, fs).map((db) => db + offset);
}

const F_LO = 20;
const F_HI = 20000;

export function freqToX(f: number, width: number): number {
  if (!(f > 0)) return 0;
  return clamp((Math.log(f / F_LO) / Math.log(F_HI / F_LO)) * width, 0, width);
}

export function xToFreq(x: number, width: number): number {
  if (!(width > 0)) return F_LO;
  return F_LO * (F_HI / F_LO) ** clamp(x / width, 0, 1);
}

/** "31", "500", "1k", "16k". */
export function bandLabel(f: number): string {
  if (f >= 1000) {
    const k = Math.round(f / 100) / 10;
    return `${k}k`;
  }
  return String(Math.round(f));
}
