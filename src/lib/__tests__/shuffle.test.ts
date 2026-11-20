import { mulberry32 } from '../random';
import { fisherYates, flowOrder, shuffleIds, spreadShuffle } from '../shuffle';
import type { Features, RawTrack, Track } from '../types';
import { feat, libOf } from './fixtures';

function rows(counts: Record<string, number>): Partial<RawTrack>[] {
  return Object.entries(counts).flatMap(([artist, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${artist}#${i}`, title: `${artist} song ${i}`, artist })),
  );
}

const primary = (t: Track) => t.artists[0];
const ids = (ts: Track[]) => ts.map((t) => t.id);
const hasAdjacentArtist = (ts: Track[]) => ts.some((t, i) => i > 0 && primary(t) === primary(ts[i - 1]));

describe('fisherYates', () => {
  it('returns a shuffled copy without touching the input', () => {
    const src = [1, 2, 3, 4, 5, 6];
    const out = fisherYates(src, mulberry32(1));
    expect(src).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...out].sort()).toEqual(src);
    expect(fisherYates(src, mulberry32(1))).toEqual(out);
    expect(fisherYates([], mulberry32(1))).toEqual([]);
  });

  it('is unbiased', () => {
    const rng = mulberry32(42);
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) {
      const k = fisherYates(['a', 'b', 'c'], rng).join('');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) expect(Math.abs(c - 1000)).toBeLessThan(150);
  });
});

describe('spreadShuffle', () => {
  const lib = libOf(rows({ 'Arijit Singh': 5, 'Diljit Dosanjh': 4, 'Prateek Kuhad': 3, Divine: 2, 'Anuv Jain': 1 }));

  it('never puts the same artist back to back when it can be avoided', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const out = spreadShuffle(lib.tracks, mulberry32(seed));
      expect(ids(out).sort()).toEqual(ids(lib.tracks).sort());
      expect(hasAdjacentArtist(out)).toBe(false);
    }
  });

  it('handles the tightest feasible case and unavoidable repeats', () => {
    const tight = libOf(rows({ 'AP Dhillon': 4, 'Karan Aujla': 3 })).tracks;
    for (let seed = 1; seed <= 30; seed++) {
      expect(spreadShuffle(tight, mulberry32(seed)).map(primary)).toEqual([
        'AP Dhillon', 'Karan Aujla', 'AP Dhillon', 'Karan Aujla', 'AP Dhillon', 'Karan Aujla', 'AP Dhillon',
      ]);
    }
    const lopsided = libOf(rows({ 'AP Dhillon': 5, 'Karan Aujla': 1 })).tracks;
    expect(ids(spreadShuffle(lopsided, mulberry32(3))).sort()).toEqual(ids(lopsided).sort());
  });

  it('spreads an artist across the whole list', () => {
    const singles = Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`Artist ${i}`, 1]));
    const tracks = libOf(rows({ 'Arijit Singh': 6, ...singles })).tracks;
    // Largest circular gap between two Arijit tracks; 4 would be perfectly even for 6 of 24.
    const worstGap = (order: Track[]) => {
      const pos = order.flatMap((t, i) => (primary(t) === 'Arijit Singh' ? [i] : []));
      let worst = pos[0] + order.length - pos[pos.length - 1];
      for (let i = 1; i < pos.length; i++) worst = Math.max(worst, pos[i] - pos[i - 1]);
      return worst;
    };
    let spread = 0;
    let random = 0;
    for (let seed = 1; seed <= 200; seed++) {
      spread += worstGap(spreadShuffle(tracks, mulberry32(seed)));
      random += worstGap(fisherYates(tracks, mulberry32(seed)));
    }
    expect(spread / 200).toBeLessThan(7.5);
    expect(spread).toBeLessThan(random * 0.8);
  });

  it('is deterministic for a seed and differs across seeds', () => {
    const a = ids(spreadShuffle(lib.tracks, mulberry32(7)));
    expect(ids(spreadShuffle(lib.tracks, mulberry32(7)))).toEqual(a);
    expect(ids(spreadShuffle(lib.tracks, mulberry32(8)))).not.toEqual(a);
  });
});

describe('flowOrder', () => {
  const flowLib = libOf(Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, title: `Flow ${i}`, artist: `Artist ${i}` })));
  // (i * 7) % 30 visits every value 0..29 once, so energies cover 0..1 evenly in a scrambled order.
  const features = new Map<string, Features>(
    flowLib.tracks.map((t) => [t.id, feat({ energy: ((Number(t.id.slice(1)) * 7) % 30) / 29, bpm: 120 })]),
  );
  const energy = (t: Track) => features.get(t.id)?.energy ?? 0;
  const meanStep = (ts: Track[]) =>
    ts.slice(1).reduce((s, t, i) => s + Math.abs(energy(t) - energy(ts[i])), 0) / (ts.length - 1);

  it('keeps every track and moves in small energy steps from a calm start', () => {
    let flow = 0;
    let random = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const out = flowOrder(flowLib.tracks, features, mulberry32(seed));
      expect(ids(out).sort()).toEqual(ids(flowLib.tracks).sort());
      expect(energy(out[0])).toBeLessThanOrEqual(9 / 29 + 1e-9);
      flow += meanStep(out);
      random += meanStep(fisherYates(flowLib.tracks, mulberry32(seed)));
    }
    expect(flow).toBeLessThan(random * 0.5);
  });

  it('interleaves unanalysed tracks and falls back to the artist spread', () => {
    const partial = new Map([...features].filter(([id]) => Number(id.slice(1)) < 10));
    const some = flowLib.tracks.filter((t) => Number(t.id.slice(1)) < 15);
    const out = flowOrder(some, partial, mulberry32(1));
    expect(out.flatMap((t, i) => (partial.has(t.id) ? [] : [i]))).toEqual([1, 4, 7, 10, 13]);
    const lib = libOf(rows({ 'Arijit Singh': 3, 'Shreya Ghoshal': 3 }));
    expect(ids(flowOrder(lib.tracks, new Map(), mulberry32(3)))).toEqual(ids(spreadShuffle(lib.tracks, mulberry32(3))));
  });
});

describe('shuffleIds', () => {
  const lib = libOf(rows({ 'Arijit Singh': 5, 'Diljit Dosanjh': 4, 'Prateek Kuhad': 3, Divine: 2, 'Anuv Jain': 1 }));
  const artistOf = (id: string) => lib.byId.get(id)?.artists[0] ?? id;
  // Duplicates and ids missing from the library must survive a shuffle.
  const queue = [...ids(lib.tracks), lib.tracks[0].id, 'deleted-track'];

  it('moves the current item to the front and shuffles the rest', () => {
    const out = shuffleIds(queue, 3, 'spread', lib, new Map(), 99);
    expect(out[0]).toBe(queue[3]);
    expect([...out].sort()).toEqual([...queue].sort());
    expect(shuffleIds(queue, 3, 'spread', lib, new Map(), 99)).toEqual(out);
    expect(shuffleIds(queue, 3, 'spread', lib, new Map(), 100)).not.toEqual(out);
    for (let seed = 1; seed <= 30; seed++) {
      const o = shuffleIds(queue, 0, 'spread', lib, new Map(), seed);
      expect(artistOf(o[1])).not.toBe(artistOf(o[0]));
    }
  });

  it('shuffles everything without a current item and supports flow mode', () => {
    expect([...shuffleIds(queue, -1, 'spread', lib, new Map(), 5)].sort()).toEqual([...queue].sort());
    expect([...shuffleIds(queue, 99, 'flow', lib, new Map(), 5)].sort()).toEqual([...queue].sort());
    expect(shuffleIds([], -1, 'spread', lib, new Map(), 5)).toEqual([]);
    const flowIds = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const flowLib = libOf(flowIds.map((id, i) => ({ id, artist: `Artist ${i}` })));
    const features = new Map(flowIds.map((id, i) => [id, feat({ energy: i / 11 })]));
    const out = shuffleIds(flowIds, 4, 'flow', flowLib, features, 1);
    expect(out[0]).toBe('f4');
    expect([...out].sort()).toEqual([...flowIds].sort());
  });
});
