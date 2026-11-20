import { create } from 'zustand';

import { clearPlays, insertPlay } from '@/db/repos';
import { buildTrackStats, updateTrackStat } from '@/lib/stats';
import type { PlayEvent, TrackStat } from '@/lib/types';
import { persist } from './persist';

type HistoryState = {
  plays: PlayEvent[];
  stats: Map<string, TrackStat>;
};

export const useHistory = create<HistoryState>()(() => ({ plays: [], stats: new Map() }));

export function hydrateHistory(plays: PlayEvent[]) {
  useHistory.setState({ plays, stats: buildTrackStats(plays) });
}

export function recordPlay(ev: PlayEvent) {
  if (!persist(() => insertPlay(ev))) return;
  const { plays, stats } = useHistory.getState();
  const next = new Map(stats);
  next.set(ev.trackId, updateTrackStat(stats.get(ev.trackId), ev));
  useHistory.setState({ plays: [...plays, ev], stats: next });
}

/** Returns false (and leaves everything as it was) if storage refused the change. */
export function clearHistory(): boolean {
  if (!persist(clearPlays)) return false;
  useHistory.setState({ plays: [], stats: new Map() });
  return true;
}
