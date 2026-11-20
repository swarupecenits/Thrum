import { useEffect, useSyncExternalStore } from 'react';

import { ThrumAudio, type TagResult } from './native';

const MAX = 48;
const cache = new Map<string, TagResult | null>();
const inflight = new Map<string, Promise<TagResult | null>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads embedded tags (lyrics, sample rate, bit depth, ReplayGain) once per track and caches them. */
export function loadTags(id: string): Promise<TagResult | null> {
  if (cache.has(id)) return Promise.resolve(cache.get(id) ?? null);
  let p = inflight.get(id);
  if (!p) {
    p = ThrumAudio.readTags(id)
      .catch(() => null)
      .then((tags) => {
        inflight.delete(id);
        cache.set(id, tags);
        while (cache.size > MAX) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined || oldest === id) break;
          cache.delete(oldest);
        }
        for (const l of [...listeners]) l();
        return tags;
      });
    inflight.set(id, p);
  }
  return p;
}

/** `undefined` while loading, `null` when the file couldn't be read. */
export function useTags(id: string | null | undefined): TagResult | null | undefined {
  const read = () => (id ? cache.get(id) : null);
  const tags = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    if (id && !cache.has(id)) void loadTags(id);
  }, [id]);
  return tags;
}
