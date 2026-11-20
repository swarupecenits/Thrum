import { create } from 'zustand';

import { estimatePosition, syncClock } from '@/audio/clock';
import { itemsFor } from '@/audio/items';
import { noteListen } from '@/audio/listens';
import {
  call,
  read,
  ThrumAudio,
  type PlaybackState,
  type PlayerStatus,
  type QueueEvent,
  type RepeatMode,
  type SleepMode,
  type SleepState,
} from '@/audio/native';
import { setSpectrumPlaying } from '@/audio/spectrum';
import { saveSetting } from '@/db/repos';
import * as Q from '@/lib/queue';
import { shuffleIds } from '@/lib/shuffle';
import type { QueueState, Track } from '@/lib/types';
import { useFeatures } from './features';
import { useLibrary } from './library';
import { setNowTrack } from './now';
import { persist } from './persist';
import { useSettings } from './settings';

export type PlaySourceKind =
  | 'album'
  | 'artist'
  | 'playlist'
  | 'genre'
  | 'folder'
  | 'mood'
  | 'daylist'
  | 'favorites'
  | 'library'
  | 'search'
  | 'vibe'
  | 'similar'
  | 'mix'
  | 'history'
  | 'queue';

/** Where the queue came from, for "Playing from …" and the back link in Now Playing. */
export type PlaySource = { kind: PlaySourceKind; id?: string; label: string };

type PlayerState = {
  status: PlayerStatus;
  playing: boolean;
  /** What the user asked for; drives the play/pause icon so taps feel instant. */
  playWhenReady: boolean;
  index: number;
  trackId: string | null;
  durationMs: number;
  repeat: RepeatMode;
  speed: number;
  pitch: number;
  skipSilence: boolean;
  error: string | null;
  /** Mirror of the native queue, by track id. */
  ids: string[];
  /** Unshuffled order while shuffle is on, else null. */
  original: string[] | null;
  source: PlaySource | null;
  sleep: SleepState;
};

const NO_SLEEP: SleepState = { endsAt: null, mode: null, fadeSec: 0 };

export const usePlayer = create<PlayerState>()(() => ({
  status: 'idle',
  playing: false,
  playWhenReady: false,
  index: -1,
  trackId: null,
  durationMs: 0,
  repeat: 'off',
  speed: 1,
  pitch: 1,
  skipSilence: false,
  error: null,
  ids: [],
  original: null,
  source: null,
  sleep: NO_SLEEP,
}));

export const SPEEDS = [0.5, 0.75, 0.85, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const lib = () => useLibrary.getState().lib;

/** The index of the playing item in the mirror (native indices can be stale mid-update). */
export function currentIndex(): number {
  const { ids, index, trackId } = usePlayer.getState();
  if (index >= 0 && index < ids.length && ids[index] === trackId) return index;
  if (trackId !== null) {
    let best = -1;
    for (let i = 0; i < ids.length; i++) {
      if (ids[i] === trackId && (best < 0 || Math.abs(i - index) < Math.abs(best - index))) best = i;
    }
    if (best >= 0) return best;
  }
  return ids.length ? Math.min(Math.max(index, 0), ids.length - 1) : -1;
}

function queueOf(): QueueState {
  const s = usePlayer.getState();
  return { ids: s.ids, index: currentIndex(), original: s.original };
}

export function currentTrack(): Track | null {
  const id = usePlayer.getState().trackId;
  return id ? (lib().byId.get(id) ?? null) : null;
}

// region persistence

type QueueMeta = { source: PlaySource | null; original: string[] | null };

let metaTimer: ReturnType<typeof setTimeout> | null = null;
let restoredMeta: QueueMeta | null = null;

function saveMeta() {
  if (metaTimer) clearTimeout(metaTimer);
  metaTimer = setTimeout(() => {
    metaTimer = null;
    const { source, original } = usePlayer.getState();
    persist(() => saveSetting('q.meta', { source, original } satisfies QueueMeta));
  }, 800);
}

/** Remembers the queue's source and unshuffled order from the last session. */
export function hydratePlayerMeta(raw: string | undefined) {
  if (!raw) return;
  try {
    const v = JSON.parse(raw) as Partial<QueueMeta> | null;
    if (!v || typeof v !== 'object') return;
    const source =
      v.source && typeof v.source === 'object' && typeof v.source.label === 'string' && typeof v.source.kind === 'string'
        ? v.source
        : null;
    const original = Array.isArray(v.original) && v.original.every((x) => typeof x === 'string') ? v.original : null;
    restoredMeta = { source, original };
  } catch {
    restoredMeta = null;
  }
}

// endregion

// region native → store

function sameIds(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Keeps the entries of `original` that are still queued (as a multiset). */
function keepQueued(original: string[], ids: string[]): string[] {
  const left = new Map<string, number>();
  for (const id of ids) left.set(id, (left.get(id) ?? 0) + 1);
  const out: string[] = [];
  for (const id of original) {
    const n = left.get(id) ?? 0;
    if (n > 0) {
      out.push(id);
      left.set(id, n - 1);
    }
  }
  return out;
}

let verifyTimer: ReturnType<typeof setTimeout> | null = null;

/** Adopts the native queue when the mirror has drifted (notification controls, restore, races). */
export function verifyQueue() {
  if (verifyTimer) {
    clearTimeout(verifyTimer);
    verifyTimer = null;
  }
  const items = read(() => ThrumAudio.getQueue(), null);
  if (!items) return;
  const ids = items.map((i) => i.id);
  const s = usePlayer.getState();
  if (sameIds(ids, s.ids)) return;
  let original: string[] | null = null;
  if (s.original) {
    const kept = keepQueued(s.original, ids);
    original = kept.length === ids.length ? kept : null;
  }
  usePlayer.setState({ ids, original });
  saveMeta();
}

function scheduleVerify() {
  verifyTimer ??= setTimeout(verifyQueue, 60);
}

export function onPlaybackEvent(s: PlaybackState) {
  noteListen(s, estimatePosition());
  const prev = usePlayer.getState();
  usePlayer.setState({
    status: s.status,
    playing: s.playing,
    playWhenReady: s.playWhenReady,
    index: s.index,
    trackId: s.trackId,
    durationMs: s.durationMs,
    repeat: s.repeat,
    speed: s.speed,
    pitch: s.pitch,
    skipSilence: s.skipSilence,
    error: s.error,
  });
  syncClock(s.positionMs, s.durationMs, s.playing, s.speed);
  setSpectrumPlaying(s.playing);
  if (s.trackId !== prev.trackId || !s.trackId) setNowTrack(s.trackId ? (lib().byId.get(s.trackId) ?? null) : null);
  const ids = usePlayer.getState().ids;
  if (s.queueLength !== ids.length || (s.index >= 0 && ids[s.index] !== s.trackId)) scheduleVerify();
}

export function onQueueEvent(e: QueueEvent) {
  const { ids, trackId } = usePlayer.getState();
  if (e.length !== ids.length || (e.index >= 0 && ids[e.index] !== trackId)) scheduleVerify();
}

export function onSleepEvent(sleep: SleepState) {
  usePlayer.setState({ sleep });
}

/** Pulls the whole native state, e.g. at start-up or when the app returns to the foreground. */
export function syncPlayer() {
  verifyQueue();
  const st = read(() => ThrumAudio.getState(), null);
  if (st) onPlaybackEvent(st);
  const sleep = read(() => ThrumAudio.getSleepTimer(), null);
  if (sleep) usePlayer.setState({ sleep });
}

/** Restores last session's queue (paused) when the player is idle. */
export async function restorePlayer() {
  let restored = false;
  try {
    restored = await ThrumAudio.restoreSession();
  } catch {
    restored = false;
  }
  syncPlayer();
  const meta = restoredMeta;
  restoredMeta = null;
  if (!restored || !meta) return;
  const ids = usePlayer.getState().ids;
  if (!ids.length) return;
  const original = meta.original && keepQueued(meta.original, ids).length === ids.length && meta.original.length === ids.length ? meta.original : null;
  usePlayer.setState({ source: meta.source, original });
}

let drift: ReturnType<typeof setInterval> | null = null;

/** Native position is the truth; re-sync the UI clock whenever it drifts (buffering, sink latency). */
export function startClockWatch(isForeground: () => boolean) {
  if (drift) return;
  drift = setInterval(() => {
    const s = usePlayer.getState();
    if (!s.playing || !isForeground()) return;
    const native = read(() => ThrumAudio.getPosition(), -1);
    if (native >= 0 && Math.abs(native - estimatePosition()) > 120) syncClock(native, s.durationMs, true, s.speed);
  }, 1000);
}

// endregion

// region actions

type PlayOptions = {
  shuffle?: boolean;
  source?: PlaySource | null;
  positionMs?: number;
  /** Start paused (default: play). */
  paused?: boolean;
};

function seed() {
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
}

function shuffled(ids: string[], index: number) {
  return shuffleIds(ids, index, useSettings.getState().shuffleMode, lib(), useFeatures.getState().map, seed());
}

function commit(q: QueueState, extra: Partial<PlayerState> = {}) {
  usePlayer.setState({ ids: q.ids, original: q.original, index: q.index, ...extra });
  saveMeta();
}

function showTrack(id: string | null, positionMs = 0) {
  const t = id ? (lib().byId.get(id) ?? null) : null;
  usePlayer.setState({ trackId: id, durationMs: t?.durationMs ?? 0, error: null });
  setNowTrack(t);
  syncClock(positionMs, t?.durationMs ?? 0, false, usePlayer.getState().speed);
}

export const player = {
  /**
   * Replaces the queue. `start` is an index into `ids`; pass -1 with `shuffle` to shuffle everything.
   * Returns false when none of the ids are in the library.
   */
  playIds(ids: string[], start = 0, opts: PlayOptions = {}): boolean {
    const l = lib();
    const valid: string[] = [];
    let at = -1;
    ids.forEach((id, i) => {
      if (!l.byId.has(id)) return;
      if (i === start) at = valid.length;
      valid.push(id);
    });
    if (!valid.length) return false;
    const q: QueueState = opts.shuffle
      ? { ids: shuffled(valid, at), index: 0, original: valid }
      : Q.makeQueue(valid, Math.max(0, at));
    const playNow = !opts.paused;
    const pos = Math.max(0, opts.positionMs ?? 0);
    commit(q, { source: opts.source ?? null, playWhenReady: playNow, status: 'buffering' });
    showTrack(q.ids[q.index], pos);
    call(ThrumAudio.setQueue(itemsFor(q.ids, l), q.index, pos, playNow), 'Playing');
    return true;
  },

  toggle() {
    const s = usePlayer.getState();
    if (!s.ids.length) return;
    const willPlay = !s.playWhenReady || s.status === 'ended' || s.status === 'idle';
    usePlayer.setState({ playWhenReady: willPlay });
    call(ThrumAudio.togglePlay(), 'Play/pause');
  },

  play() {
    if (!usePlayer.getState().ids.length) return;
    usePlayer.setState({ playWhenReady: true });
    call(ThrumAudio.play(), 'Play');
  },

  pause() {
    usePlayer.setState({ playWhenReady: false });
    call(ThrumAudio.pause(), 'Pause');
  },

  next() {
    call(ThrumAudio.next(), 'Next');
  },

  previous() {
    call(ThrumAudio.previous(), 'Previous');
  },

  /** Straight to the previous track (swipe gestures); `previous()` restarts the song first when past 3 s. */
  previousTrack() {
    const s = usePlayer.getState();
    const i = currentIndex();
    if (i > 0) player.skipTo(i - 1);
    else if (s.repeat === 'all' && s.ids.length > 1) player.skipTo(s.ids.length - 1);
    else player.seek(0);
  },

  seek(positionMs: number) {
    const s = usePlayer.getState();
    if (!s.ids.length) return;
    const pos = Math.max(0, s.durationMs > 0 ? Math.min(positionMs, s.durationMs - 250) : positionMs);
    syncClock(pos, s.durationMs, s.playing, s.speed);
    call(ThrumAudio.seekTo(pos), 'Seek');
  },

  seekBy(deltaMs: number) {
    player.seek(estimatePosition() + deltaMs);
  },

  skipTo(index: number) {
    const s = usePlayer.getState();
    if (index < 0 || index >= s.ids.length) return;
    usePlayer.setState({ index, playWhenReady: true });
    showTrack(s.ids[index]);
    call(ThrumAudio.skipTo(index, 0), 'Skip');
    if (!s.playWhenReady) call(ThrumAudio.play(), 'Play');
  },

  /** Inserts after the current track. Starts playing when nothing is queued. */
  playNext(ids: string[]): number {
    const l = lib();
    const valid = ids.filter((id) => l.byId.has(id));
    if (!valid.length) return 0;
    if (!usePlayer.getState().ids.length) {
      player.playIds(valid, 0, { source: { kind: 'queue', label: 'Queue' } });
      return valid.length;
    }
    const q = queueOf();
    const at = q.index + 1;
    commit(Q.playNext(q, valid));
    call(ThrumAudio.addItems(itemsFor(valid, l), at), 'Play next');
    return valid.length;
  },

  addToQueue(ids: string[]): number {
    const l = lib();
    const valid = ids.filter((id) => l.byId.has(id));
    if (!valid.length) return 0;
    if (!usePlayer.getState().ids.length) {
      player.playIds(valid, 0, { source: { kind: 'queue', label: 'Queue' } });
      return valid.length;
    }
    commit(Q.addToQueue(queueOf(), valid));
    call(ThrumAudio.addItems(itemsFor(valid, l), -1), 'Add to queue');
    return valid.length;
  },

  removeAt(index: number) {
    const q = queueOf();
    if (index < 0 || index >= q.ids.length) return;
    if (q.ids.length === 1) {
      player.clear();
      return;
    }
    const next = Q.removeAt(q, index);
    commit(next);
    if (index === q.index) showTrack(next.ids[next.index]);
    call(ThrumAudio.removeItem(index), 'Remove from queue');
  },

  move(from: number, to: number) {
    const q = queueOf();
    const next = Q.move(q, from, to);
    if (next === q) return;
    commit(next);
    call(ThrumAudio.moveItem(from, to), 'Reorder queue');
  },

  clearUpcoming() {
    const q = queueOf();
    const next = Q.clearUpcoming(q);
    if (next === q) return;
    commit(next);
    call(ThrumAudio.reorderQueue(itemsFor(next.ids, lib()), next.index), 'Clear queue');
  },

  /** Stops playback and empties the queue. */
  clear() {
    commit({ ids: [], index: -1, original: null }, { source: null, playWhenReady: false, playing: false, status: 'idle' });
    showTrack(null);
    call(ThrumAudio.setQueue([], 0, 0, false), 'Clear queue');
  },

  setShuffle(on: boolean) {
    const q = queueOf();
    if (!q.ids.length || on === (q.original !== null)) return;
    const next = on ? Q.shuffleOn(q, shuffled(q.ids, q.index)) : Q.shuffleOff(q);
    commit(next);
    call(ThrumAudio.reorderQueue(itemsFor(next.ids, lib()), next.index), 'Shuffle');
  },

  toggleShuffle() {
    player.setShuffle(usePlayer.getState().original === null);
  },

  /** off → all → one → off */
  cycleRepeat(): RepeatMode {
    const order: RepeatMode[] = ['off', 'all', 'one'];
    const next = order[(order.indexOf(usePlayer.getState().repeat) + 1) % order.length];
    usePlayer.setState({ repeat: next });
    call(ThrumAudio.setRepeatMode(next), 'Repeat');
    return next;
  },

  /** `vinyl`: pitch follows speed, like a turntable (0.85× gives the "slowed" sound). */
  setSpeed(speed: number, vinyl = false) {
    const s = Math.min(3, Math.max(0.25, Math.round(speed * 100) / 100));
    const pitch = vinyl ? s : 1;
    usePlayer.setState({ speed: s, pitch });
    call(ThrumAudio.setSpeed(s, pitch), 'Speed');
  },

  async setSleep(minutes: number, mode: SleepMode) {
    try {
      const sleep = await ThrumAudio.setSleepTimer(minutes, mode, useSettings.getState().sleepFadeSec);
      usePlayer.setState({ sleep });
      return true;
    } catch {
      return false;
    }
  },

  async cancelSleep() {
    try {
      usePlayer.setState({ sleep: await ThrumAudio.cancelSleepTimer() });
    } catch {
      usePlayer.setState({ sleep: NO_SLEEP });
    }
  },
};

// endregion
