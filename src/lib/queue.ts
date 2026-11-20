import type { QueueState } from './types';

// Every helper is immutable and works by index, so the same id may appear in the queue more than once.

function clampIndex(i: number, length: number): number {
  if (length === 0) return -1;
  if (!Number.isFinite(i)) return 0;
  return Math.min(length - 1, Math.max(0, Math.trunc(i)));
}

function valid(q: QueueState, i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < q.ids.length;
}

/** How many times ids[i] occurs at or before i (1-based), to find "the same" duplicate in another order. */
function occurrence(ids: string[], i: number): number {
  let n = 0;
  for (let k = 0; k <= i; k++) if (ids[k] === ids[i]) n++;
  return n;
}

function nthIndexOf(ids: string[], id: string, nth: number): number {
  let seen = 0;
  let first = -1;
  for (let k = 0; k < ids.length; k++) {
    if (ids[k] !== id) continue;
    if (first < 0) first = k;
    if (++seen === nth) return k;
  }
  return first;
}

/** Keeps the items of `original` that are still queued (as a multiset), in original order. */
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

export function makeQueue(ids: string[], index: number): QueueState {
  return { ids: ids.slice(), index: clampIndex(index, ids.length), original: null };
}

export function current(q: QueueState): string | null {
  return valid(q, q.index) ? q.ids[q.index] : null;
}

/** Inserts right after the current item. While shuffled, the items are also appended to the original order. */
export function playNext(q: QueueState, ids: string[]): QueueState {
  if (!ids.length) return q;
  const at = valid(q, q.index) ? q.index + 1 : 0;
  const next = [...q.ids.slice(0, at), ...ids, ...q.ids.slice(at)];
  return {
    ids: next,
    index: valid(q, q.index) ? q.index : 0,
    original: q.original ? [...q.original, ...ids] : null,
  };
}

export function addToQueue(q: QueueState, ids: string[]): QueueState {
  if (!ids.length) return q;
  return {
    ids: [...q.ids, ...ids],
    index: valid(q, q.index) ? q.index : clampIndex(q.ids.length, q.ids.length + ids.length),
    original: q.original ? [...q.original, ...ids] : null,
  };
}

/** Removing the current item leaves the index on the item that followed it (or the new last item). */
export function removeAt(q: QueueState, i: number): QueueState {
  if (!valid(q, i)) return q;
  const ids = q.ids.filter((_, k) => k !== i);
  const index = i < q.index ? q.index - 1 : clampIndex(q.index, ids.length);
  return { ids, index: ids.length ? index : -1, original: q.original ? keepQueued(q.original, ids) : null };
}

/** Moves an item; the current item stays current. */
export function move(q: QueueState, from: number, to: number): QueueState {
  if (!valid(q, from) || !Number.isInteger(to)) return q;
  const target = Math.min(q.ids.length - 1, Math.max(0, to));
  if (target === from) return q;
  const ids = q.ids.slice();
  const [item] = ids.splice(from, 1);
  ids.splice(target, 0, item);
  let index = q.index;
  if (from === q.index) index = target;
  else if (from < q.index && target >= q.index) index--;
  else if (from > q.index && target <= q.index) index++;
  return { ids, index, original: q.original };
}

export function jumpTo(q: QueueState, i: number): QueueState {
  return valid(q, i) ? { ...q, index: i } : q;
}

/** Applies a shuffled order (e.g. from shuffleIds, current item first) and remembers the unshuffled one. */
export function shuffleOn(q: QueueState, shuffled: string[]): QueueState {
  const cur = current(q);
  let index = shuffled.length ? 0 : -1;
  if (cur !== null && shuffled[0] !== cur) {
    const at = shuffled.indexOf(cur);
    if (at >= 0) index = at;
  }
  return { ids: shuffled.slice(), index, original: q.original ?? q.ids.slice() };
}

/** Restores the original order (plus anything queued while shuffled) and keeps the current item current. */
export function shuffleOff(q: QueueState): QueueState {
  if (!q.original) return q;
  const ids = q.original.slice();
  const cur = current(q);
  let index = clampIndex(q.index, ids.length);
  if (cur !== null) {
    const at = nthIndexOf(ids, cur, occurrence(q.ids, q.index));
    if (at >= 0) index = at;
  }
  return { ids, index, original: null };
}

export function clearUpcoming(q: QueueState): QueueState {
  if (!valid(q, q.index) || q.index === q.ids.length - 1) return q;
  const ids = q.ids.slice(0, q.index + 1);
  return { ids, index: q.index, original: q.original ? keepQueued(q.original, ids) : null };
}

export function upcoming(q: QueueState): string[] {
  return q.ids.slice(Math.max(0, q.index + 1));
}

/** Index to play when the current track ends; 'one' repeats the current track. */
export function nextIndex(q: QueueState, repeat: 'off' | 'all' | 'one'): number | null {
  if (!q.ids.length) return null;
  if (!valid(q, q.index)) return 0;
  if (repeat === 'one') return q.index;
  if (q.index + 1 < q.ids.length) return q.index + 1;
  return repeat === 'all' ? 0 : null;
}

export function prevIndex(q: QueueState, repeat: 'off' | 'all' | 'one'): number | null {
  if (!q.ids.length) return null;
  if (!valid(q, q.index)) return 0;
  if (repeat === 'one') return q.index;
  if (q.index > 0) return q.index - 1;
  return repeat === 'all' ? q.ids.length - 1 : null;
}
