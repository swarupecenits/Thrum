import {
  BAND_Q,
  EQ_BANDS,
  FLAT_SOUND,
  PRESETS,
  THRUM_SOUND,
  applyPreset,
  autoHeadroomDb,
  bandLabel,
  curveDb,
  freqToX,
  logFreqs,
  matchPreset,
  responseDb,
  sanitizeSound,
  xToFreq,
} from '../eq';
import type { SoundParams } from '../types';

const NO_RUMBLE: SoundParams = { ...FLAT_SOUND, rumble: false };
const FREQS = logFreqs(200, 20, 20000);
const band = (i: number, db: number): number[] => EQ_BANDS.map((_, k) => (k === i ? db : 0));
const at = (p: SoundParams, f: number, fs?: number) => curveDb(p, [f], fs)[0];

describe('constants', () => {
  it('match the native engine', () => {
    expect(EQ_BANDS).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
    expect(BAND_Q).toBe(1.41);
    expect(THRUM_SOUND).toMatchObject({ bands: [2.5, 2, 0.5, 0, 0, 0, 0, 0.5, 1, 1.5], bassDb: 4, bassFreq: 80, phantom: 0.15 });
  });
});

describe('curveDb', () => {
  it('is 0 dB everywhere when flat, and the rumble filter only touches the sub-sonic range', () => {
    for (const db of curveDb(NO_RUMBLE, FREQS)) expect(Math.abs(db)).toBeLessThan(1e-9);
    const withRumble = curveDb(FLAT_SOUND, FREQS);
    FREQS.forEach((f, i) => {
      if (f >= 60) expect(Math.abs(withRumble[i])).toBeLessThan(0.05);
    });
    expect(at(FLAT_SOUND, 25)).toBeCloseTo(-3.01, 1);
    expect(at(FLAT_SOUND, 10)).toBeLessThan(-25);
  });

  it('peaks at exactly the band gain', () => {
    const p = { ...NO_RUMBLE, bands: band(5, 6) };
    expect(at(p, 1000)).toBeCloseTo(6, 1);
    expect(Math.abs(at(p, 1000) - 6)).toBeLessThan(0.05);
    expect(Math.abs(at(p, 100))).toBeLessThan(0.3);
    expect(at({ ...NO_RUMBLE, bands: band(5, -6) }, 1000)).toBeCloseTo(-6, 5);
  });

  it('models the bass and treble shelves', () => {
    const bass = { ...NO_RUMBLE, bassDb: 6, bassFreq: 80 };
    expect(at(bass, 20)).toBeGreaterThan(5.7);
    expect(at(bass, 20)).toBeLessThanOrEqual(6.01);
    expect(at(bass, 80)).toBeCloseTo(3, 1);
    expect(Math.abs(at(bass, 1000))).toBeLessThan(0.1);
    const treble = { ...NO_RUMBLE, trebleDb: 4 };
    expect(at(treble, 7000)).toBeCloseTo(2, 1);
    expect(at(treble, 20000)).toBeGreaterThan(3.7);
    expect(Math.abs(at(treble, 200))).toBeLessThan(0.05);
  });

  it('skips bands too close to Nyquist', () => {
    const top = { ...NO_RUMBLE, bands: band(9, 12) };
    expect(at(top, 15000, 32000)).toBe(0);
    expect(at(top, 16000, 44100)).toBeCloseTo(12, 1);
  });
});

describe('headroom', () => {
  it('is zero when flat and cuts 0.75x the largest boost', () => {
    expect(autoHeadroomDb(FLAT_SOUND)).toBe(0);
    const loud = { ...NO_RUMBLE, bands: band(5, 12) };
    expect(autoHeadroomDb(loud)).toBeCloseTo(-9, 0);
    expect(autoHeadroomDb({ ...loud, autoHeadroom: false })).toBe(0);
    expect(autoHeadroomDb({ ...FLAT_SOUND, phantom: 0.5 })).toBeCloseTo(-1, 5);
    expect(autoHeadroomDb({ ...FLAT_SOUND, bassDb: 12, bands: EQ_BANDS.map(() => 12) })).toBe(-12);
  });

  it('adds preamp and headroom to the response', () => {
    const p = { ...NO_RUMBLE, bands: band(5, 12), preampDb: -1 };
    const [r] = responseDb(p, [1000]);
    expect(r).toBeCloseTo(12 - 1 + autoHeadroomDb(p), 9);
    expect(Math.max(...responseDb(p, FREQS))).toBeLessThan(3);
  });
});

describe('sanitizeSound', () => {
  it('clamps every field and fills gaps from the base', () => {
    const s = sanitizeSound({
      enabled: false,
      preampDb: 20,
      bands: [20, -20, Number.NaN, 1, 0, 0, 0, 0, 0, 0, 7],
      bassDb: -3,
      bassFreq: 500,
      phantom: 2,
      trebleDb: -9,
      width: 5,
      balance: -3,
    });
    expect(s).toEqual({
      ...FLAT_SOUND,
      enabled: false,
      preampDb: 6,
      bands: [12, -12, 0, 1, 0, 0, 0, 0, 0, 0],
      bassDb: 0,
      bassFreq: 150,
      phantom: 1,
      trebleDb: -6,
      width: 2,
      balance: -1,
    });
    expect(sanitizeSound(null)).toEqual(FLAT_SOUND);
    expect(sanitizeSound({ preampDb: Number.NaN, bands: [1, 2] }, THRUM_SOUND)).toEqual({
      ...THRUM_SOUND,
      bands: [1, 2, 0.5, 0, 0, 0, 0, 0.5, 1, 1.5],
    });
    expect(sanitizeSound({ bassFreq: 10 }).bassFreq).toBe(40);
  });
});

describe('presets', () => {
  it('cover the required sounds with blurbs', () => {
    const ids = PRESETS.map((p) => p.id);
    for (const id of ['flat', 'thrum', 'bass-head', 'deep-bass', 'bass-treble', 'warm', 'vocal', 'bollywood', 'punjabi',
      'lofi', 'edm', 'hiphop', 'acoustic', 'classical', 'late-night', 'podcast', 'small-speaker', 'car']) {
      expect(ids).toContain(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PRESETS) expect(p.blurb.length).toBeGreaterThan(10);
  });

  it('are already within limits and engineer-sensible', () => {
    for (const p of PRESETS) {
      const full = { ...FLAT_SOUND, ...p.params };
      expect(sanitizeSound(full)).toEqual(full);
      if (p.id !== 'bass-head') expect(Math.max(...full.bands, full.bassDb)).toBeLessThanOrEqual(9);
    }
    const bassHead = PRESETS.find((p) => p.id === 'bass-head');
    expect(Math.max(...curveDb({ ...FLAT_SOUND, ...bassHead?.params }, logFreqs(64, 20, 200)))).toBeGreaterThan(9);
  });

  it('keep output settings unless the preset sets them', () => {
    const base = { ...THRUM_SOUND, enabled: false, width: 1.4, balance: 0.2, limiter: false };
    const punjabi = PRESETS.find((p) => p.id === 'punjabi');
    const classical = PRESETS.find((p) => p.id === 'classical');
    if (!punjabi || !classical) throw new Error('missing presets');
    expect(applyPreset(base, punjabi)).toMatchObject({ enabled: false, width: 1.4, balance: 0.2, limiter: false });
    expect(applyPreset(base, punjabi).bands).toEqual(punjabi.params.bands);
    expect(applyPreset(base, classical).width).toBe(1.1);
    const flat = PRESETS.find((p) => p.id === 'flat');
    if (!flat) throw new Error('missing flat');
    expect(applyPreset(base, flat)).toEqual({ ...FLAT_SOUND, enabled: false, width: 1.4, balance: 0.2, limiter: false });
  });

  it('round-trip through matchPreset', () => {
    const base = { ...FLAT_SOUND, width: 0.8, balance: -0.1 };
    for (const p of PRESETS) expect(matchPreset(applyPreset(base, p))).toBe(p.id);
    expect(matchPreset(THRUM_SOUND)).toBe('thrum');
    expect(matchPreset({ ...THRUM_SOUND, bands: THRUM_SOUND.bands.map((b, i) => (i === 3 ? b + 0.04 : b)) })).toBe('thrum');
    expect(matchPreset({ ...THRUM_SOUND, bands: band(3, 1.5) })).toBeNull();
    expect(matchPreset({ ...THRUM_SOUND, bassFreq: 120 })).toBeNull();
  });
});

describe('frequency axis helpers', () => {
  it('builds log-spaced frequencies', () => {
    const f = logFreqs(3, 20, 20000);
    expect(f[0]).toBeCloseTo(20, 9);
    expect(f[1]).toBeCloseTo(632.456, 2);
    expect(f[2]).toBeCloseTo(20000, 6);
    expect(logFreqs(0)).toEqual([]);
    expect(logFreqs(1)).toEqual([20]);
  });

  it('maps frequencies to x and back on a log scale', () => {
    expect(freqToX(20, 300)).toBe(0);
    expect(freqToX(20000, 300)).toBeCloseTo(300, 9);
    expect(freqToX(632.456, 300)).toBeCloseTo(150, 2);
    expect(xToFreq(freqToX(1000, 320), 320)).toBeCloseTo(1000, 6);
    expect(freqToX(5, 300)).toBe(0);
    expect(freqToX(50000, 300)).toBe(300);
    expect(xToFreq(-10, 300)).toBe(20);
  });

  it('labels bands compactly', () => {
    expect(EQ_BANDS.map(bandLabel)).toEqual(['31', '62', '125', '250', '500', '1k', '2k', '4k', '8k', '16k']);
    expect(bandLabel(1500)).toBe('1.5k');
  });
});
