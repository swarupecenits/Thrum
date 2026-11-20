import { create } from 'zustand';

import { ThrumAudio, type AnalysisEvent } from '@/audio/native';
import { clearFeatures, saveFeatures, type FeatureRow } from '@/db/repos';
import type { Features, Library } from '@/lib/types';
import { persist } from './persist';

type FeaturesState = {
  map: Map<string, Features>;
  /** Tracks the analyser couldn't read (DRM, unsupported codec, damaged file). */
  failed: Set<string>;
  /** Tracks still waiting in the native queue. */
  remaining: number;
  running: boolean;
};

export const useFeatures = create<FeaturesState>()(() => ({
  map: new Map(),
  failed: new Set(),
  remaining: 0,
  running: false,
}));

/** dateModified of each analysed file, so edited files get analysed again. */
const modifiedOf = new Map<string, number>();
const map = new Map<string, Features>();
const failed = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastRemaining = 0;

const FEATURE_VERSION = 1;

function isFeatures(v: unknown): v is Features {
  if (!v || typeof v !== 'object') return false;
  const f = v as Record<string, unknown>;
  return typeof f.bpm === 'number' && typeof f.energy === 'number' && typeof f.valence === 'number';
}

function flush() {
  flushTimer = null;
  useFeatures.setState({ map: new Map(map), failed: new Set(failed), remaining: lastRemaining, running: lastRemaining > 0 });
}

function scheduleFlush(now = false) {
  if (now) {
    if (flushTimer) clearTimeout(flushTimer);
    flush();
    return;
  }
  flushTimer ??= setTimeout(flush, 1200);
}

export function hydrateFeatures(rows: FeatureRow[]) {
  for (const r of rows) {
    modifiedOf.set(r.trackId, r.modified);
    if (r.features && isFeatures(r.features) && (r.features.v ?? FEATURE_VERSION) >= FEATURE_VERSION) {
      map.set(r.trackId, r.features);
    } else if (r.error) {
      failed.add(r.trackId);
    }
  }
  scheduleFlush(true);
}

/** Drops results for files that changed or disappeared, then queues everything not analysed yet. */
export function startAnalysis(lib: Library, priority: string[] = []) {
  let changed = false;
  for (const id of [...modifiedOf.keys()]) {
    const t = lib.byId.get(id);
    if (t && t.dateModified !== modifiedOf.get(id)) {
      modifiedOf.delete(id);
      changed = map.delete(id) || changed;
      changed = failed.delete(id) || changed;
    }
  }
  const pending = (id: string) => !map.has(id) && !failed.has(id);
  const seen = new Set<string>();
  const order: { id: string; durationMs: number }[] = [];
  const push = (id: string) => {
    if (seen.has(id)) return;
    const t = lib.byId.get(id);
    if (!t || !pending(id)) return;
    seen.add(id);
    order.push({ id, durationMs: t.durationMs });
  };
  for (const id of priority) push(id);
  const byNewest = [...lib.tracks].sort((a, b) => b.dateAdded - a.dateAdded);
  for (const t of byNewest) push(t.id);

  lastRemaining = order.length;
  if (changed || order.length !== useFeatures.getState().remaining) scheduleFlush(true);
  if (!order.length) return;
  ThrumAudio.analyze(order).catch(() => {
    lastRemaining = 0;
    scheduleFlush(true);
  });
}

export function stopAnalysis() {
  try {
    ThrumAudio.cancelAnalysis();
  } catch {
    // not connected yet; nothing is queued
  }
  lastRemaining = 0;
  scheduleFlush(true);
}

export function onAnalysisEvent(e: AnalysisEvent, lib: Library) {
  const modified = lib.byId.get(e.id)?.dateModified ?? 0;
  lastRemaining = Math.max(0, e.remaining);
  if (e.features && isFeatures(e.features)) {
    map.set(e.id, e.features);
    failed.delete(e.id);
    modifiedOf.set(e.id, modified);
    persist(() => saveFeatures(e.id, modified, e.features, null));
  } else {
    failed.add(e.id);
    modifiedOf.set(e.id, modified);
    persist(() => saveFeatures(e.id, modified, null, e.error ?? 'unsupported'));
  }
  scheduleFlush(lastRemaining === 0);
}

/** Forgets every result so the whole library is analysed again. False if storage refused. */
export function resetAnalysis(): boolean {
  stopAnalysis();
  if (!persist(clearFeatures)) return false;
  map.clear();
  failed.clear();
  modifiedOf.clear();
  scheduleFlush(true);
  return true;
}

/** Leveling: bring loud masters down toward -14 LUFS. Attenuation only, so nothing can clip. */
export function levelingGainDb(id: string): number | null {
  const f = map.get(id);
  if (!f || !Number.isFinite(f.loudnessLufs) || f.loudnessLufs < -70) return null;
  return Math.round(Math.max(-12, Math.min(0, -14 - f.loudnessLufs)) * 10) / 10;
}

export function featuresOf(id: string): Features | undefined {
  return map.get(id);
}
