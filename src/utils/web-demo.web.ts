import { SAMPLE_NOW, sampleLibrary } from '@/lib/sample-library';
import { DAY_MS } from '@/lib/time';
import { hydrateHistory, useHistory } from '@/stores/history';

let seeded = false;

/**
 * Browser demo: lays ~90 days of believable listening under whatever was played in this browser, so
 * stats, the daylist and "On repeat" have something to say. Whole-day shifts keep the time-of-day
 * patterns intact. Nothing here is written to storage.
 */
export function seedWebDemo(): void {
  if (seeded) return;
  seeded = true;
  const now = Date.now();
  const shift = Math.floor((now - SAMPLE_NOW) / DAY_MS) * DAY_MS;
  const sample = sampleLibrary()
    .plays.map((p) => ({ ...p, startedAt: p.startedAt + shift }))
    .filter((p) => p.startedAt < now);
  const own = useHistory.getState().plays;
  hydrateHistory([...sample, ...own].sort((a, b) => a.startedAt - b.startedAt));
}
