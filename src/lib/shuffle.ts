import { harmonicCompatible, tempoDistance } from './features';
import { artistIdOf, primaryArtist } from './library';
import { mulberry32 } from './random';
import type { Features, Library, Track } from './types';

/** Unbiased shuffle; returns a new array. */
export function fisherYates<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

function artistKey(t: Track): string {
  return artistIdOf(primaryArtist(t));
}

type Keyed<T> = { item: T; k: string };

/**
 * Reorders a dithered list so no two neighbours share a key, staying as close to the dithered
 * order as possible. Each pick must leave a remainder that can still be arranged: every key at
 * most ceil(n/2) times, and the key just placed at most floor(n/2) times.
 */
function separate<T>(items: Keyed<T>[], lastKey: string): Keyed<T>[] {
  const n = items.length;
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.k, (counts.get(it.k) ?? 0) + 1);
  let max = 0;
  for (const c of counts.values()) max = Math.max(max, c);
  // Adjacency is unavoidable; the dithered order already spaces the big group evenly.
  if (max > Math.floor((n + 1) / 2)) return items;
  let last = (counts.get(lastKey) ?? 0) > Math.floor(n / 2) ? '' : lastKey;
  const bucket = new Array<number>(max + 1).fill(0);
  for (const c of counts.values()) bucket[c]++;
  const used = new Uint8Array(n);
  const out: Keyed<T>[] = [];
  let head = 0;
  for (let remaining = n; remaining > 0; remaining--) {
    while (used[head]) head++;
    const rest = remaining - 1;
    let pick = head;
    for (let i = head; i < n; i++) {
      if (used[i] || items[i].k === last) continue;
      const c = counts.get(items[i].k) ?? 0;
      const maxAfter = c === max && bucket[max] === 1 ? max - 1 : max;
      if (maxAfter <= Math.floor((rest + 1) / 2) && c - 1 <= Math.floor(rest / 2)) {
        pick = i;
        break;
      }
    }
    const it = items[pick];
    used[pick] = 1;
    out.push(it);
    const c = counts.get(it.k) ?? 0;
    counts.set(it.k, c - 1);
    bucket[c]--;
    bucket[c - 1]++;
    while (max > 0 && bucket[max] === 0) max--;
    last = it.k;
  }
  return out;
}

/** Spotify-style dithering: each key's items are spread evenly with a random offset and a little jitter. */
function spreadBy<T>(items: T[], keyOf: (t: T) => string, rng: () => number, lastKey = ''): T[] {
  if (items.length < 2) return items.slice();
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  const placed: (Keyed<T> & { pos: number })[] = [];
  for (const [k, g] of groups) {
    const members = fisherYates(g, rng);
    const n = members.length;
    const offset = rng() / n;
    members.forEach((item, i) => {
      placed.push({ item, k, pos: offset + i / n + ((rng() - 0.5) * 0.2) / n });
    });
  }
  placed.sort((a, b) => a.pos - b.pos);
  return separate(placed, lastKey).map((p) => p.item);
}

/** Artist-aware shuffle: no same-artist neighbours when avoidable, each artist spread across the list. */
export function spreadShuffle(tracks: Track[], rng: () => number): Track[] {
  return spreadBy(tracks, artistKey, rng);
}

type FlowNode<T> = { item: T; f: Features; k: string };

function usable(f: Features | undefined): f is Features {
  return Boolean(f && Number.isFinite(f.energy));
}

function transitionCost(a: { f: Features; k: string }, b: { f: Features; k: string }): number {
  const valence = Number.isFinite(a.f.valence) && Number.isFinite(b.f.valence) ? Math.abs(a.f.valence - b.f.valence) : 0.25;
  return (
    2 * Math.abs(a.f.energy - b.f.energy) +
    0.8 * tempoDistance(a.f.bpm, b.f.bpm) +
    0.5 * valence +
    (harmonicCompatible(a.f, b.f) ? 0 : 0.25) +
    (a.k === b.k ? 0.6 : 0)
  );
}

/** Spreads `b` evenly between the items of `a`. */
function interleave<T>(a: T[], b: T[]): T[] {
  if (!b.length) return a;
  if (!a.length) return b;
  const total = a.length + b.length;
  const slots = new Set<number>();
  for (let j = 0; j < b.length; j++) slots.add(Math.floor(((j + 0.5) * total) / b.length));
  const out: T[] = [];
  let ia = 0;
  let ib = 0;
  for (let i = 0; i < total; i++) out.push(slots.has(i) ? b[ib++] : a[ia++]);
  return out;
}

const FLOW_SAMPLE = 64;

function flowBy<T>(
  items: T[],
  keyOf: (t: T) => string,
  featOf: (t: T) => Features | undefined,
  rng: () => number,
  anchor?: { f: Features; k: string },
): T[] {
  const pool: FlowNode<T>[] = [];
  const loose: T[] = [];
  for (const item of items) {
    const f = featOf(item);
    if (usable(f)) pool.push({ item, f, k: keyOf(item) });
    else loose.push(item);
  }
  if (!pool.length) return spreadBy(items, keyOf, rng, anchor?.k);
  const nodes = fisherYates(pool, rng);
  const path: T[] = [];
  let prev = anchor;
  if (!prev) {
    // Start somewhere in the calmest third so the flow has room to build.
    const byEnergy = nodes.map((node, i) => ({ i, e: node.f.energy })).sort((x, y) => x.e - y.e || x.i - y.i);
    const third = Math.max(1, Math.ceil(byEnergy.length / 3));
    const start = byEnergy[Math.min(third - 1, Math.floor(rng() * third))].i;
    prev = nodes[start];
    path.push(nodes[start].item);
    nodes[start] = nodes[nodes.length - 1];
    nodes.pop();
  }
  while (nodes.length) {
    const n = nodes.length;
    let bestI = 0;
    let bestCost = Infinity;
    for (let s = 0; s < Math.min(n, FLOW_SAMPLE); s++) {
      const i = n <= FLOW_SAMPLE ? s : Math.floor(rng() * n);
      const cost = transitionCost(prev, nodes[i]) + rng() * 0.15;
      if (cost < bestCost) {
        bestCost = cost;
        bestI = i;
      }
    }
    const next = nodes[bestI];
    nodes[bestI] = nodes[n - 1];
    nodes.pop();
    path.push(next.item);
    prev = next;
  }
  return interleave(path, spreadBy(loose, keyOf, rng));
}

/** Smooth "DJ" order: small steps in energy and tempo, compatible keys, a little randomness. */
export function flowOrder(tracks: Track[], features: Map<string, Features>, rng: () => number): Track[] {
  return flowBy(tracks, artistKey, (t) => features.get(t.id), rng);
}

/** Shuffles a queue; the current item (if any) moves to the front and the rest is reordered after it. */
export function shuffleIds(
  ids: string[],
  currentIndex: number,
  mode: 'spread' | 'flow',
  lib: Library,
  features: Map<string, Features>,
  seed: number,
): string[] {
  const rng = mulberry32(seed);
  const hasCurrent = Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < ids.length;
  const rest = hasCurrent ? ids.filter((_, i) => i !== currentIndex) : ids.slice();
  const keyOf = (id: string): string => {
    const t = lib.byId.get(id);
    return t ? artistKey(t) : `?${id}`;
  };
  if (!hasCurrent) return mode === 'flow' ? flowBy(rest, keyOf, (id) => features.get(id), rng) : spreadBy(rest, keyOf, rng);
  const cur = ids[currentIndex];
  const curKey = keyOf(cur);
  const curF = features.get(cur);
  const order =
    mode === 'flow'
      ? flowBy(rest, keyOf, (id) => features.get(id), rng, usable(curF) ? { f: curF, k: curKey } : undefined)
      : spreadBy(rest, keyOf, rng, curKey);
  return [cur, ...order];
}
