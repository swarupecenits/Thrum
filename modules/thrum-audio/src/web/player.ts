import type {
  PlaybackState,
  PlayerStatus,
  QueueEvent,
  QueueItem,
  RepeatMode,
  SleepMode,
  SleepState,
} from '../ThrumAudio.types';
import { findTrack } from './library';
import type { SpectrumInput } from './spectrum';
import { clamp, finite, int, isRecord, now } from './util';

export type PlayerSink = {
  playback: (state: PlaybackState) => void;
  queue: (event: QueueEvent) => void;
  sleep: (state: SleepState) => void;
};

type Item = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  durationMs: number;
  artworkUri: string | null;
};

/** Timed transitions the simulation schedules: buffering done, end of item, sleep deadline. */
type Due = 'ready' | 'end' | 'sleep';

/** Local files open almost instantly, but long enough for the UI to see `buffering`. */
const BUFFER_MS = 80;
/** Media3's default maxSeekToPreviousPosition: `previous` restarts the item after this. */
const RESTART_MS = 3000;
const FALLBACK_DURATION_MS = 180_000;
const MAX_DELAY_MS = 2 ** 31 - 1;
/** Bound on transitions applied in one go (e.g. a throttled background tab catching up). */
const MAX_STEPS = 64;

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

function toItem(v: unknown): Item | null {
  if (!isRecord(v) || typeof v.id !== 'string' || v.id === '') return null;
  const albumId =
    typeof v.albumId === 'string'
      ? v.albumId
      : typeof v.albumId === 'number' && Number.isFinite(v.albumId)
        ? String(Math.trunc(v.albumId))
        : '';
  return {
    id: v.id,
    title: text(v.title),
    artist: text(v.artist),
    album: text(v.album),
    albumId,
    durationMs: Math.max(0, finite(v.durationMs, 0)),
    artworkUri: typeof v.artworkUri === 'string' ? v.artworkUri : null,
  };
}

/**
 * A silent stand-in for PlayerHub + Media3: same queue/transport rules and the same events, with the
 * position extrapolated from a monotonic clock. One timeout is armed for the next transition only.
 */
export class PlayerSim {
  private items: Item[] = [];
  private readonly gains = new Map<string, number>();
  private index = -1;
  private status: PlayerStatus = 'idle';
  private playWhenReady = false;
  /** Position at `posAt` (performance.now() ms); extrapolated while playing. */
  private posMs = 0;
  private posAt = 0;
  private readyAt = 0;
  private repeat: RepeatMode = 'off';
  private speed = 1;
  private pitch = 1;
  private skipSilence = false;
  private leveling = true;
  private version = 0;
  private sleepMode: SleepMode | null = null;
  private sleepEndsAt: number | null = null;
  private sleepDeadline = 0;
  private fadeSec = 0;
  private dueAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirtyPlayback = false;
  private dirtyQueue = false;
  private dirtySleep = false;
  private readonly sink: PlayerSink;

  constructor(sink: PlayerSink) {
    this.sink = sink;
  }

  // region reads

  state(): PlaybackState {
    const t = this.sync();
    const item = this.current();
    return {
      status: this.status,
      playing: this.isPlaying(),
      playWhenReady: this.playWhenReady,
      index: item ? this.index : -1,
      trackId: item?.id ?? null,
      positionMs: Math.floor(this.positionAt(t)),
      durationMs: Math.round(this.duration()),
      repeat: this.repeat,
      speed: this.speed,
      pitch: this.pitch,
      skipSilence: this.skipSilence,
      queueVersion: this.version,
      queueLength: this.items.length,
      leveling: this.leveling,
      error: null,
    };
  }

  position(): number {
    return Math.floor(this.positionAt(this.sync()));
  }

  queue(): QueueItem[] {
    return this.items.map((it) => ({ ...it, gainDb: this.gains.get(it.id) ?? null }));
  }

  hasItems(): boolean {
    return this.items.length > 0;
  }

  sleep(): SleepState {
    this.sync();
    return this.sleepState();
  }

  /** Fills `out` with what the spectrum synthesizer needs (no allocation; it is polled per frame). */
  spectrumInput(out: SpectrumInput): SpectrumInput {
    const t = this.sync();
    const item = this.current();
    out.playing = this.isPlaying();
    out.trackId = item?.id ?? null;
    out.positionMs = this.positionAt(t);
    out.durationMs = this.duration();
    out.pitch = this.pitch;
    out.fade = this.fadeAt(t);
    out.gainDb = this.leveling && item ? (this.gains.get(item.id) ?? 0) : 0;
    return out;
  }

  // endregion

  // region queue

  setQueue(raw: unknown, startIndex: unknown, startPositionMs: unknown, playWhenReady: unknown): void {
    const list = this.remember(raw);
    this.mutate((t) => {
      if (!list.length) {
        // player.stop() + clearMediaItems()
        const had = this.items.length > 0;
        const wasIdle = this.status === 'idle';
        this.items = [];
        this.index = -1;
        this.posMs = 0;
        this.status = 'idle';
        if (had) this.markQueue();
        else if (!wasIdle) this.markPlayback();
        return;
      }
      this.items = list;
      this.index = clamp(int(startIndex, 0), 0, list.length - 1);
      this.posMs = clamp(int(startPositionMs, 0), 0, this.duration());
      this.posAt = t;
      this.prepare(t);
      this.playWhenReady = playWhenReady === true;
      this.markQueue();
    });
  }

  reorderQueue(raw: unknown, currentIndex: unknown): void {
    const list = this.remember(raw);
    const ci = int(currentIndex, 0);
    this.mutate((t) => {
      const current = this.current();
      if (current && ci >= 0 && ci < list.length && list[ci].id === current.id) {
        // Fast path: everything around the playing item is swapped, playback is untouched.
        const before = this.items.length;
        this.items = list;
        this.index = ci;
        if (before > 1 || list.length > 1) this.markQueue();
        return;
      }
      if (!list.length) {
        if (!this.items.length) return;
        this.items = [];
        this.index = -1;
        this.posMs = 0;
        if (this.status !== 'idle') this.status = 'ended';
        this.markQueue();
        return;
      }
      const index = clamp(ci, 0, list.length - 1);
      const keep = current !== undefined && list[index].id === current.id;
      const prepared = this.status !== 'idle';
      this.items = list;
      this.index = index;
      this.posMs = keep ? Math.min(this.posMs, this.duration()) : 0;
      this.posAt = t;
      if (prepared) this.prepare(t);
      this.markQueue();
    });
  }

  addItems(raw: unknown, atIndex: unknown): void {
    const list = this.remember(raw);
    if (!list.length) return;
    this.mutate((t) => {
      const n = this.items.length;
      const at = finite(atIndex, -1);
      const i = at < 0 ? n : clamp(Math.trunc(at), 0, n);
      this.items.splice(i, 0, ...list);
      if (n === 0) {
        // Media3 treats filling an empty playlist like setMediaItems: it re-buffers if prepared.
        this.index = 0;
        this.posMs = 0;
        this.posAt = t;
        if (this.status !== 'idle') this.prepare(t);
      } else if (i <= this.index) {
        this.index += list.length;
      }
      this.markQueue();
    });
  }

  removeItem(index: unknown): void {
    const i = int(index, -1);
    if (i < 0 || i >= this.items.length) return;
    this.mutate((t) => {
      this.items.splice(i, 1);
      if (!this.items.length) {
        this.index = -1;
        this.posMs = 0;
        if (this.status !== 'idle') this.status = 'ended';
      } else if (i < this.index) {
        this.index--;
      } else if (i === this.index) {
        this.posMs = 0;
        this.posAt = t;
        if (i >= this.items.length) {
          // The playing tail item went away: Media3 masks to the first item and ends.
          this.index = 0;
          if (this.status !== 'idle') this.status = 'ended';
        } else if (this.status === 'ready' || this.status === 'buffering') {
          this.prepare(t);
        }
      }
      this.markQueue();
    });
  }

  moveItem(from: unknown, to: unknown): void {
    const n = this.items.length;
    const f = int(from, -1);
    if (f < 0 || f >= n) return;
    const dest = clamp(int(to, 0), 0, n - 1);
    if (f === dest) return;
    this.mutate(() => {
      const [item] = this.items.splice(f, 1);
      this.items.splice(dest, 0, item);
      const cur = this.index;
      if (f === cur) this.index = dest;
      else if (f < cur && cur <= dest) this.index = cur - 1;
      else if (dest <= cur && cur < f) this.index = cur + 1;
      this.markQueue();
    });
  }

  // endregion

  // region transport

  /** Util.handlePlayButtonAction: prepare when idle, restart the item when ended, then play. */
  play(): void {
    if (!this.items.length) return;
    this.mutate((t) => {
      let changed = false;
      if (this.status === 'idle') {
        this.prepare(t);
        changed = true;
      } else if (this.status === 'ended') {
        this.posMs = 0;
        this.prepare(t);
        changed = true;
      }
      if (!this.playWhenReady) {
        this.playWhenReady = true;
        changed = true;
      }
      if (changed) this.markPlayback();
    });
  }

  pause(): void {
    if (!this.playWhenReady) return;
    this.mutate(() => {
      this.playWhenReady = false;
      this.markPlayback();
    });
  }

  /** Util.handlePlayPauseButtonAction. */
  togglePlay(): void {
    if (!this.items.length) return;
    if (!this.playWhenReady || this.status === 'idle' || this.status === 'ended') this.play();
    else this.pause();
  }

  seekTo(positionMs: unknown): void {
    if (!this.items.length) return;
    const target = Math.max(0, int(positionMs, 0));
    this.mutate((t) => {
      const duration = this.duration();
      if (this.status === 'idle') {
        this.posMs = Math.min(target, duration);
      } else if (target >= duration) {
        // Seeking past the end behaves like reaching it.
        if (this.status === 'ended') this.status = 'ready';
        this.advance(t);
      } else {
        this.posMs = target;
        if (this.status === 'ended') this.status = 'ready';
      }
      this.markPlayback();
    });
  }

  next(): void {
    if (!this.items.length) return;
    this.mutate((t) => {
      const target = this.index + 1 < this.items.length ? this.index + 1 : this.repeat === 'all' ? 0 : -1;
      if (target >= 0) {
        this.goTo(target, 0, t);
      } else {
        // PlayerHub: at the end of the queue, rewind to the first item and pause.
        this.goTo(0, 0, t);
        this.playWhenReady = false;
      }
      this.markPlayback();
    });
  }

  /** Player.seekToPrevious: previous item within the first 3 s, otherwise restart this one. */
  previous(): void {
    if (!this.items.length) return;
    this.mutate((t) => {
      const target = this.index > 0 ? this.index - 1 : this.repeat === 'all' ? this.items.length - 1 : -1;
      this.goTo(target >= 0 && this.posMs <= RESTART_MS ? target : this.index, 0, t);
      this.markPlayback();
    });
  }

  skipTo(index: unknown, positionMs: unknown): void {
    const i = int(index, -1);
    if (i < 0 || i >= this.items.length) return;
    this.mutate((t) => {
      this.goTo(i, Math.max(0, int(positionMs, 0)), t);
      this.markPlayback();
    });
  }

  /** player.stop(): releases the decoder but keeps queue, position and playWhenReady. */
  stop(): void {
    if (this.status === 'idle') return;
    this.mutate(() => {
      this.status = 'idle';
      this.markPlayback();
    });
  }

  // endregion

  // region settings

  setRepeatMode(mode: unknown): void {
    const next: RepeatMode = mode === 'all' || mode === 'one' ? mode : 'off';
    if (next === this.repeat) return;
    this.mutate(() => {
      this.repeat = next;
      this.markPlayback();
    });
  }

  setSpeed(speed: unknown, pitch: unknown): void {
    const s = typeof speed === 'number' && Number.isFinite(speed) ? clamp(speed, 0.25, 3) : 1;
    const p = typeof pitch === 'number' && Number.isFinite(pitch) ? clamp(pitch, 0.5, 2) : 1;
    if (s === this.speed && p === this.pitch) return;
    this.mutate(() => {
      this.speed = s;
      this.pitch = p;
      this.markPlayback();
    });
  }

  setSkipSilence(enabled: unknown): void {
    this.mutate(() => {
      this.skipSilence = enabled === true;
      this.markPlayback();
    });
  }

  setLeveling(enabled: unknown): void {
    this.mutate(() => {
      this.leveling = enabled === true;
      this.markPlayback();
    });
  }

  setItemGain(id: unknown, gainDb: unknown): void {
    if (typeof id !== 'string') return;
    if (typeof gainDb === 'number' && Number.isFinite(gainDb)) this.gains.set(id, clamp(gainDb, -24, 0));
    else this.gains.delete(id);
  }

  // endregion

  // region sleep timer

  /** SleepTimer.set: `track` pauses at the end of the current item, `time` at a wall-clock moment. */
  setSleep(minutes: unknown, mode: unknown, fadeSec: unknown): SleepState {
    this.mutate((t) => {
      this.clearSleep();
      this.fadeSec = clamp(int(fadeSec, 0), 0, 120);
      if (mode === 'track') {
        this.sleepMode = 'track';
      } else {
        const ms = Math.floor(clamp(finite(minutes, 0.05), 0.05, 24 * 60) * 60_000);
        this.sleepMode = 'time';
        this.sleepEndsAt = Date.now() + ms;
        this.sleepDeadline = t + ms;
      }
      this.markSleep();
    });
    return this.sleepState();
  }

  cancelSleep(): SleepState {
    this.mutate(() => {
      this.clearSleep();
      this.markSleep();
    });
    return this.sleepState();
  }

  // endregion

  /** Clears both timers; the state is kept. */
  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.timer = null;
    this.flushTimer = null;
  }

  // region internals

  private sleepState(): SleepState {
    return { endsAt: this.sleepEndsAt, mode: this.sleepMode, fadeSec: this.fadeSec };
  }

  private current(): Item | undefined {
    return this.index >= 0 ? this.items[this.index] : undefined;
  }

  /** The decoder's idea of the length: the queue item's, else the file's, else a nominal 3 minutes. */
  private duration(): number {
    const item = this.current();
    if (!item) return 0;
    const ms = item.durationMs > 0 ? item.durationMs : (findTrack(item.id)?.durationMs ?? 0);
    return Math.max(1000, ms > 0 ? ms : FALLBACK_DURATION_MS);
  }

  private isPlaying(): boolean {
    return this.playWhenReady && this.status === 'ready' && this.index >= 0;
  }

  private positionAt(t: number): number {
    if (!this.isPlaying()) return this.posMs;
    return Math.min(this.duration(), this.posMs + Math.max(0, t - this.posAt) * this.speed);
  }

  /** SleepTimer.tick's fade: (remaining / fade)² over the last `fadeSec` seconds. */
  private fadeAt(t: number): number {
    if (this.sleepMode === null || this.fadeSec <= 0) return 1;
    const fadeMs = this.fadeSec * 1000;
    const remaining =
      this.sleepMode === 'time' ? this.sleepDeadline - t : (this.duration() - this.positionAt(t)) / this.speed;
    if (remaining < 0 || remaining > fadeMs) return 1;
    const x = remaining / fadeMs;
    return x * x;
  }

  /** Normalizes incoming items and remembers their gains (PlayerHub.rememberGains). */
  private remember(raw: unknown): Item[] {
    if (!Array.isArray(raw)) return [];
    const out: Item[] = [];
    for (const v of raw) {
      const item = toItem(v);
      if (!item) continue;
      out.push(item);
      if (isRecord(v) && typeof v.gainDb === 'number' && Number.isFinite(v.gainDb)) {
        this.gains.set(item.id, clamp(v.gainDb, -24, 0));
      }
    }
    return out;
  }

  /** Every change starts from an up-to-date position and ends with the timer re-armed. */
  private mutate(fn: (t: number) => void): void {
    const t = now();
    this.process(t);
    this.posMs = this.positionAt(t);
    this.posAt = t;
    fn(t);
    this.arm();
  }

  private sync(): number {
    const t = now();
    if (this.process(t)) this.arm();
    return t;
  }

  private prepare(t: number): void {
    this.status = 'buffering';
    this.readyAt = t + BUFFER_MS;
  }

  /** Player.seekTo(index, position): another item re-buffers, a seek inside this one is instant. */
  private goTo(index: number, positionMs: number, t: number): void {
    const changed = index !== this.index;
    this.index = index;
    this.posMs = Math.min(positionMs, this.duration());
    this.posAt = t;
    if (this.status === 'idle') return;
    if (changed) this.prepare(t);
    else if (this.status === 'ended') this.status = 'ready';
  }

  /** The current item played out: Media3's auto-transition, honouring repeat and the track sleep timer. */
  private advance(at: number): void {
    this.posMs = this.duration();
    this.posAt = at;
    if (this.sleepMode === 'track') {
      // pauseAtEndOfMediaItems: stop on the last frame; play() carries on with the next item.
      this.playWhenReady = false;
      this.clearSleep();
      this.markSleep();
    } else if (this.repeat === 'one') {
      this.posMs = 0;
    } else if (this.index + 1 < this.items.length) {
      this.index++;
      this.posMs = 0;
    } else if (this.repeat === 'all') {
      this.index = 0;
      this.posMs = 0;
    } else {
      this.status = 'ended';
    }
    this.markPlayback();
  }

  private clearSleep(): void {
    this.sleepMode = null;
    this.sleepEndsAt = null;
    this.sleepDeadline = 0;
  }

  /** Earliest pending transition, with its time left in `dueAt`. */
  private nextDue(): Due | null {
    let due: Due | null = null;
    let at = Infinity;
    if (this.status === 'buffering' && this.index >= 0) {
      due = 'ready';
      at = this.readyAt;
    }
    if (this.isPlaying()) {
      const end = this.posAt + Math.max(0, this.duration() - this.posMs) / this.speed;
      if (end < at) {
        due = 'end';
        at = end;
      }
    }
    if (this.sleepMode === 'time' && this.sleepDeadline < at) {
      due = 'sleep';
      at = this.sleepDeadline;
    }
    this.dueAt = at;
    return due;
  }

  /** Applies, in order, every transition due by `t`; true if anything happened. */
  private process(t: number): boolean {
    let changed = false;
    for (let i = 0; i < MAX_STEPS; i++) {
      const due = this.nextDue();
      if (due === null || this.dueAt > t + 1) break;
      const at = this.dueAt;
      changed = true;
      if (due === 'ready') {
        this.status = 'ready';
        this.posAt = at;
        this.markPlayback();
      } else if (due === 'end') {
        this.advance(at);
      } else {
        // SleepTimer: pauseForSleep(), then clear() and emitSleep().
        this.posMs = this.positionAt(at);
        this.posAt = at;
        if (this.playWhenReady) {
          this.playWhenReady = false;
          this.markPlayback();
        }
        this.clearSleep();
        this.markSleep();
      }
    }
    return changed;
  }

  private arm(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.nextDue() === null) return;
    this.timer = setTimeout(this.tick, clamp(Math.ceil(this.dueAt - now()), 0, MAX_DELAY_MS));
  }

  private readonly tick = (): void => {
    this.timer = null;
    try {
      this.process(now());
      this.flush();
    } catch {
      // A broken listener must not stop the simulated clock.
    }
    this.arm();
  };

  private markPlayback(): void {
    this.dirtyPlayback = true;
    this.scheduleFlush();
  }

  /** Every queue mutation bumps the version once and announces both queue and playback. */
  private markQueue(): void {
    this.version++;
    this.dirtyQueue = true;
    this.markPlayback();
  }

  private markSleep(): void {
    this.dirtySleep = true;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    this.flushTimer ??= setTimeout(this.flush, 0);
  }

  /** Delivers pending events like native does: after the call returns, sleep, playback, then queue. */
  private readonly flush = (): void => {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const { dirtySleep, dirtyPlayback, dirtyQueue } = this;
    this.dirtySleep = false;
    this.dirtyPlayback = false;
    this.dirtyQueue = false;
    if (dirtySleep) this.sink.sleep(this.sleepState());
    if (dirtyPlayback) this.sink.playback(this.state());
    if (dirtyQueue) {
      this.sink.queue({ version: this.version, index: this.current() ? this.index : -1, length: this.items.length });
    }
  };

  // endregion
}
