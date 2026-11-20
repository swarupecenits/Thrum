import { isSkip } from '@/lib/stats';
import { recordPlay } from '@/stores/history';
import type { PlaybackState } from './native';

type Listen = {
  trackId: string;
  startedAt: number;
  /** Track time heard, i.e. wall-clock playing time multiplied by the speed. */
  playedMs: number;
  durationMs: number;
  since: number | null;
  speed: number;
};

const END_MARGIN_MS = 4000;

let cur: Listen | null = null;

function finish(l: Listen, reachedEnd: boolean) {
  const playedMs = Math.round(l.playedMs);
  if (playedMs < 1000) return;
  const completed = reachedEnd || (l.durationMs > 0 && playedMs >= l.durationMs * 0.9);
  recordPlay({
    trackId: l.trackId,
    startedAt: l.startedAt,
    playedMs,
    durationMs: l.durationMs,
    completed,
    skipped: !completed && isSkip(playedMs, l.durationMs),
  });
}

const nearEnd = (l: Listen, pos: number) => l.durationMs > 0 && pos >= l.durationMs - END_MARGIN_MS;

/**
 * Turns the stream of player states into listens for history and stats.
 * `estimatedPos` is where the clock thought the previous track was, read before it is re-synced.
 */
export function noteListen(s: PlaybackState, estimatedPos: number) {
  const now = Date.now();
  if (cur && cur.since !== null) {
    cur.playedMs += Math.max(0, now - cur.since) * cur.speed;
    cur.since = null;
  }
  const ended = s.status === 'ended';
  if (cur && (cur.trackId !== s.trackId || ended)) {
    finish(cur, ended || nearEnd(cur, estimatedPos));
    cur = null;
  } else if (cur && nearEnd(cur, estimatedPos) && s.positionMs < 3000) {
    // Same track again from the top: repeat-one, or a replay right at the end.
    finish(cur, true);
    cur = null;
  }
  if (ended || !s.trackId) return;
  cur ??= { trackId: s.trackId, startedAt: now, playedMs: 0, durationMs: s.durationMs, since: null, speed: 1 };
  if (s.durationMs > 0) cur.durationMs = s.durationMs;
  cur.speed = s.speed > 0 ? s.speed : 1;
  if (s.playing) cur.since = now;
}
