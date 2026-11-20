import { useCallback, useSyncExternalStore } from 'react';

import { ThrumAudio, type ArtworkResult, type ArtworkSize } from './native';

/**
 * Artwork loader shared by every cover on screen. Results are cached for the session, identical
 * requests share one native call, and at most a few decode at once. The newest request goes first,
 * and requests nobody is waiting for any more (rows scrolled away) are dropped before they start.
 */

type Entry = {
  key: string;
  albumId: string;
  trackId: string;
  size: ArtworkSize;
  result?: ArtworkResult;
  /** Components currently showing this artwork. */
  watchers: number;
  /** Promise callers (Now Playing) that must get an answer even with no watchers. */
  pinned: ((r: ArtworkResult) => void)[];
  listeners: Set<() => void>;
  state: 'idle' | 'queued' | 'loading' | 'done';
};

const MAX_IN_FLIGHT = 4;
const NONE: ArtworkResult = { uri: null, palette: null };

const entries = new Map<string, Entry>();
const stack: Entry[] = [];
let inFlight = 0;

/** Mirrors the native cache: albums share artwork, loose tracks get their own. */
export function artKey(albumId: string, trackId: string, size: ArtworkSize): string {
  const album = /^\d+$/.test(albumId) && albumId !== '0' ? `a${albumId}` : `t${trackId}`;
  return `${album}:${size}`;
}

function entryFor(albumId: string, trackId: string, size: ArtworkSize): Entry {
  const key = artKey(albumId, trackId, size);
  let e = entries.get(key);
  if (!e) {
    e = { key, albumId, trackId, size, watchers: 0, pinned: [], listeners: new Set(), state: 'idle' };
    entries.set(key, e);
  }
  return e;
}

function settle(e: Entry, result: ArtworkResult) {
  e.result = result;
  e.state = 'done';
  const pinned = e.pinned;
  e.pinned = [];
  for (const resolve of pinned) resolve(result);
  for (const l of [...e.listeners]) l();
}

function pump() {
  while (inFlight < MAX_IN_FLIGHT && stack.length) {
    const e = stack.pop()!;
    if (e.state !== 'queued') continue;
    if (e.watchers === 0 && e.pinned.length === 0) {
      e.state = 'idle';
      continue;
    }
    e.state = 'loading';
    inFlight += 1;
    ThrumAudio.getArtwork(e.albumId, e.trackId, e.size)
      .then(
        (r) => settle(e, r && typeof r === 'object' ? { uri: r.uri ?? null, palette: r.palette ?? null } : NONE),
        () => settle(e, NONE),
      )
      .finally(() => {
        inFlight -= 1;
        pump();
      });
  }
}

function request(e: Entry) {
  if (e.state === 'idle') {
    e.state = 'queued';
    stack.push(e);
  } else if (e.state === 'queued') {
    // Bump to the top: it was just asked for again, so it's probably on screen now.
    const i = stack.lastIndexOf(e);
    if (i >= 0 && i !== stack.length - 1) {
      stack.splice(i, 1);
      stack.push(e);
    }
  }
  pump();
}

export function cachedArtwork(albumId: string, trackId: string, size: ArtworkSize): ArtworkResult | undefined {
  return entries.get(artKey(albumId, trackId, size))?.result;
}

export function loadArtwork(albumId: string, trackId: string, size: ArtworkSize): Promise<ArtworkResult> {
  const e = entryFor(albumId, trackId, size);
  if (e.result) return Promise.resolve(e.result);
  return new Promise((resolve) => {
    e.pinned.push(resolve);
    request(e);
  });
}

/** Forget everything, e.g. after the user clears the artwork cache or the library changes a lot. */
export function resetArtwork() {
  stack.length = 0;
  for (const e of entries.values()) {
    if (e.state === 'done') {
      e.result = undefined;
      e.state = 'idle';
      if (e.watchers > 0) request(e);
      for (const l of [...e.listeners]) l();
    }
  }
}

/** Artwork for a track or album; undefined while loading, `{ uri: null }` when there is none. */
export function useArtwork(
  albumId: string | null | undefined,
  trackId: string | null | undefined,
  size: ArtworkSize,
): ArtworkResult | undefined {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (albumId == null || !trackId) return () => {};
      const e = entryFor(albumId, trackId, size);
      e.listeners.add(onChange);
      e.watchers += 1;
      if (!e.result) request(e);
      return () => {
        e.listeners.delete(onChange);
        e.watchers -= 1;
      };
    },
    [albumId, trackId, size],
  );
  const snapshot = useCallback(
    () => (albumId != null && trackId ? entries.get(artKey(albumId, trackId, size))?.result : undefined),
    [albumId, trackId, size],
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
