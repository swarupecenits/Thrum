import { curveDb } from '../../../../src/lib/eq';
import { hashString, mulberry32 } from '../../../../src/lib/random';
import type { Spectrum } from '../ThrumAudio.types';
import { featuresFor } from './features';
import type { SoundSim } from './sound';
import { bump, clamp, finite, hash01, now, smoothstep } from './util';

const BANDS = 48;
/** Band centres, log-spaced 30 Hz..16 kHz like the native analyser. */
const CENTERS = Array.from({ length: BANDS }, (_, b) => 30 * (16000 / 30) ** ((b + 0.5) / BANDS));
/** Octaves above 30 Hz: the x axis every spectral shape below is drawn on. */
const OCT = CENTERS.map((f) => Math.log2(f / 30));
const TAU = Math.PI * 2;
const LIMITER_CEILING_DB = -0.3;

export type SpectrumInput = {
  playing: boolean;
  trackId: string | null;
  positionMs: number;
  durationMs: number;
  pitch: number;
  /** Sleep-timer fade, linear 0..1. */
  fade: number;
  /** Leveling gain applied to the current item, dB (<= 0). */
  gainDb: number;
};

const unit = (v: number, fallback: number): number => clamp(finite(v, fallback), 0, 1);

/**
 * A synthetic, musical-looking analyser frame: a tonal balance from the track's analysed features,
 * a kick/snare/hat groove at its BPM, a wandering melody, smooth per-band motion, intro/outro and
 * sleep fades, then the live EQ curve on top. Everything is a pure function of the playback position
 * plus meter-style smoothing, so scrubbing and replays look the same.
 */
export class SpectrumSynth {
  private readonly level = new Float64Array(BANDS);
  /** Static tonal balance of the current track at the current pitch, dB. */
  private readonly shape = new Float64Array(BANDS);
  private readonly kickW = new Float64Array(BANDS);
  private readonly snareW = new Float64Array(BANDS);
  private readonly hatW = new Float64Array(BANDS);
  private readonly xs = new Float64Array(BANDS);
  private readonly phaseA = new Float64Array(BANDS);
  private readonly phaseB = new Float64Array(BANDS);
  private readonly rate = new Float64Array(BANDS);
  private readonly eq = new Float64Array(BANDS);
  private trackId: string | null = null;
  private pitch = 1;
  private seed = 0;
  private swellPhase = 0;
  private bpm = 110;
  private energy = 0.5;
  private bassAmt = 0.5;
  private subAmt = 0.4;
  private bright = 0.5;
  private loud = 0;
  private eqVersion = -1;
  private eqBass = 0;
  private limiter = false;
  private started = false;
  private last = 0;
  private bass = 0;
  private peak = -120;
  private reduction = 0;

  frame(input: SpectrumInput, sound: SoundSim): Spectrum | null {
    if (sound.version !== this.eqVersion) this.loadEq(sound);
    if (input.trackId !== null && input.trackId !== this.trackId) this.loadTrack(input.trackId);
    const pitch = clamp(finite(input.pitch, 1), 0.5, 2);
    if (pitch !== this.pitch) this.reshape(pitch);
    const live = input.playing && input.trackId !== null;
    // Like the native tap, there is nothing to report before any audio has played.
    if (!live && !this.started) return null;
    this.started = true;

    const t = now();
    const dt = clamp((t - this.last) / 1000, 0.001, 0.1);
    this.last = t;
    const rise = 1 - Math.exp(-dt / 0.025);
    const fall = 1 - Math.exp(-dt / 0.28);
    let bassTarget = 0;

    if (live) {
      const pos = Math.max(0, finite(input.positionMs, 0)) / 1000;
      const remain = Math.max(0, finite(input.durationMs, 0) - finite(input.positionMs, 0)) / 1000;
      const beats = (pos * this.bpm) / 60;
      const beat = Math.floor(beats);
      const frac = beats - beat;
      const kick = Math.exp(-7 * frac) * (beat % 4 === 0 ? 1 : 0.85);
      const snare = beat % 2 === 1 ? Math.exp(-9 * frac) : 0;
      const hat = Math.exp(-14 * (beats * 2 - Math.floor(beats * 2)));
      const swell = Math.sin((TAU * beats) / 32 + this.swellPhase);
      // A new melody note every two beats, gliding into the next one.
      const step = Math.floor(beats / 2);
      const glide = smoothstep(0.75, 1, beats / 2 - step);
      const mel = 3.4 + 3.1 * (hash01(this.seed, step) * (1 - glide) + hash01(this.seed, step + 1) * glide);
      const intro = smoothstep(0, 3.5, pos);
      const outro = smoothstep(0, 6, remain);
      const fade = clamp(finite(input.fade, 1), 0, 1);
      const env =
        -24 * (1 - intro) -
        30 * (1 - outro) +
        Math.max(-80, 20 * Math.log10(Math.max(fade, 1e-4))) +
        Math.min(0, finite(input.gainDb, 0));

      for (let b = 0; b < BANDS; b++) {
        const r = this.rate[b];
        const motion =
          2.2 * Math.sin(pos * r + this.phaseA[b]) +
          1.2 * Math.sin(pos * r * 2.3 + this.phaseB[b]) +
          1.4 * Math.sin(pos * r * 11.3 + this.phaseB[b]) * Math.sin(pos * 7.1 + this.phaseA[b]);
        const db =
          this.shape[b] +
          kick * this.kickW[b] +
          snare * this.snareW[b] +
          hat * this.hatW[b] +
          7 * bump(this.xs[b], mel, 0.35) +
          2 * swell +
          motion +
          this.eq[b] +
          this.loud +
          env;
        const target = clamp((db + 72) / 60, 0, 1);
        const cur = this.level[b];
        this.level[b] = cur + (target - cur) * (target > cur ? rise : fall);
      }

      bassTarget = clamp(
        kick ** 1.3 *
          (0.45 + 0.55 * this.bassAmt) *
          (0.9 + 0.1 * swell) *
          clamp(pos / 3.5, 0, 1) *
          clamp(remain / 6, 0, 1) *
          fade *
          clamp(1 + this.eqBass / 24, 0.75, 1.25),
        0,
        1,
      );

      const peakRaw = -2.6 + 2.2 * kick * (0.4 + 0.6 * this.energy) + 0.6 * swell + this.eqBass + env + 0.3 * this.loud;
      const over = this.limiter ? Math.max(0, peakRaw - LIMITER_CEILING_DB) : 0;
      this.reduction = Math.max(over, this.reduction - 20 * dt);
      const out = this.limiter ? Math.min(peakRaw, LIMITER_CEILING_DB) : peakRaw;
      this.peak = out > this.peak ? out : Math.max(out, this.peak - 24 * dt);
    } else {
      for (let b = 0; b < BANDS; b++) {
        const v = this.level[b] * (1 - fall);
        this.level[b] = v < 1e-3 ? 0 : v;
      }
      this.reduction = Math.max(0, this.reduction - 20 * dt);
      this.peak = Math.max(-120, this.peak - 90 * dt);
    }

    const bassRate = 1 - Math.exp(-dt / (bassTarget > this.bass ? 0.012 : 0.15));
    this.bass += (bassTarget - this.bass) * bassRate;
    if (this.bass < 1e-3) this.bass = 0;

    return { bands: Array.from(this.level), bass: this.bass, peakDb: this.peak, reductionDb: this.reduction };
  }

  private loadTrack(id: string): void {
    const f = featuresFor(id);
    let bpm = finite(f.bpm, 110) > 0 ? finite(f.bpm, 110) : 110;
    while (bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    this.bpm = bpm;
    this.energy = unit(f.energy, 0.5);
    this.bassAmt = unit(f.bass, 0.5);
    this.subAmt = unit(f.subBass, 0.4);
    this.bright = unit(f.brightness, 0.5);
    this.loud = clamp((finite(f.loudnessLufs, -14) + 14) * 0.5, -4, 4);
    const rng = mulberry32(hashString(`spectrum|${id}`));
    for (let b = 0; b < BANDS; b++) {
      this.phaseA[b] = rng() * TAU;
      this.phaseB[b] = rng() * TAU;
      this.rate[b] = 0.5 + rng() * 1.3;
    }
    this.swellPhase = rng() * TAU;
    this.seed = hashString(id);
    this.trackId = id;
    this.reshape(this.pitch);
  }

  /** Pitch shifting moves the whole picture along the frequency axis. */
  private reshape(pitch: number): void {
    this.pitch = pitch;
    const shift = Math.log2(pitch);
    for (let b = 0; b < BANDS; b++) {
      const x = OCT[b] - shift;
      this.xs[b] = x;
      this.shape[b] =
        -32 -
        2.6 * x +
        (this.bassAmt * 8 - 3) * bump(x, 1.4, 1) +
        (this.subAmt * 8 - 3) * bump(x, 0.4, 0.6) +
        3 * this.energy * bump(x, 5, 1.5) +
        (this.bright - 0.5) * 8 * smoothstep(5.5, 8, x) -
        6 * smoothstep(8.4, 9.1, x);
      this.kickW[b] = 12 * (0.5 + this.energy / 2) * bump(x, 1.1, 0.9);
      this.snareW[b] = 8 * bump(x, 5.2, 1.2) + 3 * smoothstep(6, 8, x);
      this.hatW[b] = 5 * this.bright * smoothstep(7, 8.5, x);
    }
  }

  /** What the engine applies after the decoder: tone curve, preamp, headroom, phantom harmonics. */
  private loadEq(sound: SoundSim): void {
    const p = sound.params;
    const on = p.enabled && !sound.bypass;
    const curve = on ? curveDb(p, CENTERS) : null;
    const offset = on ? p.preampDb + sound.headroom : 0;
    let sum = 0;
    let n = 0;
    for (let b = 0; b < BANDS; b++) {
      const db = curve ? curve[b] + offset + 4 * p.phantom * bump(OCT[b], 2.4, 0.7) : 0;
      this.eq[b] = db;
      if (OCT[b] >= 0.4 && OCT[b] <= 2.3) {
        sum += db;
        n++;
      }
    }
    this.eqBass = n ? sum / n : 0;
    this.limiter = on && p.limiter;
    this.eqVersion = sound.version;
  }
}
