import { useMemo, useSyncExternalStore } from 'react';

import { useClock } from './use-clock';
import { HOUR_MS } from '@/lib/time';
import type { Features, Track, VibeContext } from '@/lib/types';
import { useCollections } from '@/stores/collections';
import { useFeatures } from '@/stores/features';
import { useHistory } from '@/stores/history';
import { useLibrary } from '@/stores/library';
import { usePlayer } from '@/stores/player';

// While the analyser runs, the features map changes every second or so. Recommendations only need to
// catch up now and then, so they read a "settled" copy that refreshes every 20 s and when it finishes.
const SETTLE_MS = 20_000;
let settled: Map<string, Features> = useFeatures.getState().map;
let settledAt = 0;
let settleTimer: ReturnType<typeof setTimeout> | null = null;
const settleListeners = new Set<() => void>();

function settle() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  settled = useFeatures.getState().map;
  settledAt = Date.now();
  for (const l of [...settleListeners]) l();
}

useFeatures.subscribe((s) => {
  if (s.map === settled) return;
  const wait = SETTLE_MS - (Date.now() - settledAt);
  if (!s.running || wait <= 0) settle();
  else settleTimer ??= setTimeout(settle, wait);
});

function subscribeSettled(listener: () => void) {
  settleListeners.add(listener);
  return () => settleListeners.delete(listener);
}

const readSettled = () => settled;

/** Everything the recommendation helpers need; stable until one of its parts (or the hour) changes. */
export function useVibeContext(): VibeContext {
  const lib = useLibrary((s) => s.lib);
  const features = useSyncExternalStore(subscribeSettled, readSettled, readSettled);
  const stats = useHistory((s) => s.stats);
  const favorites = useCollections((s) => s.favorites);
  const now = useClock(HOUR_MS);
  return useMemo(() => ({ lib, features, stats, favorites, now }), [lib, features, stats, favorites, now]);
}

/** The playing track, or null. */
export function useNowTrack(): Track | null {
  const id = usePlayer((s) => s.trackId);
  return useLibrary((s) => (id ? (s.lib.byId.get(id) ?? null) : null));
}
