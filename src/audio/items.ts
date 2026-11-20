import type { Library, Track } from '@/lib/types';
import { levelingGainDb } from '@/stores/features';
import type { QueueItem } from './native';

export function itemFor(t: Track): QueueItem {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumId: t.albumId,
    durationMs: t.durationMs,
    gainDb: levelingGainDb(t.id),
  };
}

/** One item per id, in order, so queue indices stay aligned with the native player. */
export function itemsFor(ids: string[], lib: Library): QueueItem[] {
  return ids.map((id) => {
    const t = lib.byId.get(id);
    // A track deleted since it was queued: the player skips it when it fails to open.
    return t ? itemFor(t) : { id, title: '', artist: '', album: '', albumId: '', durationMs: 0 };
  });
}
