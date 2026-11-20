import {
  addToQueue,
  clearUpcoming,
  current,
  jumpTo,
  makeQueue,
  move,
  nextIndex,
  playNext,
  prevIndex,
  removeAt,
  shuffleOff,
  shuffleOn,
  upcoming,
} from '../queue';

describe('queue basics', () => {
  const q = makeQueue(['a', 'b', 'c', 'd'], 1);

  it('makes queues and reads them', () => {
    expect(current(q)).toBe('b');
    expect(upcoming(q)).toEqual(['c', 'd']);
    expect(makeQueue(['a'], 5).index).toBe(0);
    expect(makeQueue([], 0)).toEqual({ ids: [], index: -1, original: null });
    expect(current(makeQueue([], 0))).toBeNull();
    expect(upcoming(makeQueue(['a', 'b'], 1))).toEqual([]);
  });

  it('inserts next or appends without mutating', () => {
    expect(playNext(q, ['x', 'y'])).toEqual({ ids: ['a', 'b', 'x', 'y', 'c', 'd'], index: 1, original: null });
    expect(addToQueue(q, ['x'])).toEqual({ ids: ['a', 'b', 'c', 'd', 'x'], index: 1, original: null });
    expect(playNext(makeQueue([], -1), ['x'])).toEqual({ ids: ['x'], index: 0, original: null });
    expect(current(addToQueue(makeQueue([], -1), ['x', 'y']))).toBe('x');
    expect(playNext(q, [])).toBe(q);
    expect(q.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('removes items and keeps the right one current', () => {
    expect(removeAt(q, 0)).toEqual({ ids: ['b', 'c', 'd'], index: 0, original: null });
    expect(current(removeAt(q, 1))).toBe('c');
    expect(removeAt(q, 3)).toEqual({ ids: ['a', 'b', 'c'], index: 1, original: null });
    expect(current(removeAt(makeQueue(['a', 'b', 'c'], 2), 2))).toBe('b');
    expect(removeAt(makeQueue(['a'], 0), 0)).toEqual({ ids: [], index: -1, original: null });
    expect(removeAt(q, 9)).toBe(q);
  });

  it('moves items and keeps the current item current', () => {
    expect(move(q, 0, 3)).toEqual({ ids: ['b', 'c', 'd', 'a'], index: 0, original: null });
    expect(move(q, 3, 0)).toEqual({ ids: ['d', 'a', 'b', 'c'], index: 2, original: null });
    expect(move(q, 1, 3)).toEqual({ ids: ['a', 'c', 'd', 'b'], index: 3, original: null });
    expect(move(q, 2, 3)).toEqual({ ids: ['a', 'b', 'd', 'c'], index: 1, original: null });
    expect(move(q, 0, 99).ids).toEqual(['b', 'c', 'd', 'a']);
    expect(move(q, 2, 2)).toBe(q);
  });

  it('jumps and clears upcoming', () => {
    expect(jumpTo(q, 3).index).toBe(3);
    expect(jumpTo(q, 4)).toBe(q);
    expect(clearUpcoming(q)).toEqual({ ids: ['a', 'b'], index: 1, original: null });
  });

  it('computes next and previous for every repeat mode', () => {
    const last = makeQueue(['a', 'b', 'c'], 2);
    expect(nextIndex(last, 'off')).toBeNull();
    expect(nextIndex(last, 'all')).toBe(0);
    expect(nextIndex(last, 'one')).toBe(2);
    expect(nextIndex(q, 'off')).toBe(2);
    const first = makeQueue(['a', 'b', 'c'], 0);
    expect(prevIndex(first, 'off')).toBeNull();
    expect(prevIndex(first, 'all')).toBe(2);
    expect(prevIndex(first, 'one')).toBe(0);
    expect(prevIndex(q, 'off')).toBe(0);
    expect(nextIndex(makeQueue([], 0), 'all')).toBeNull();
    expect(prevIndex(makeQueue([], 0), 'all')).toBeNull();
  });
});

describe('duplicates', () => {
  // The second 'a' is playing.
  const q = makeQueue(['a', 'b', 'a', 'c'], 2);

  it('operates by index', () => {
    expect(removeAt(q, 0)).toEqual({ ids: ['b', 'a', 'c'], index: 1, original: null });
    expect(removeAt(q, 2)).toEqual({ ids: ['a', 'b', 'c'], index: 2, original: null });
    expect(move(q, 2, 0)).toEqual({ ids: ['a', 'a', 'b', 'c'], index: 0, original: null });
    expect(playNext(q, ['a'])).toEqual({ ids: ['a', 'b', 'a', 'a', 'c'], index: 2, original: null });
    expect(nextIndex(q, 'off')).toBe(3);
  });
});

describe('shuffle on and off', () => {
  const q = makeQueue(['a', 'b', 'c', 'd', 'e'], 2);

  it('remembers the original order and restores it with items queued meanwhile', () => {
    const s = shuffleOn(q, ['c', 'e', 'a', 'd', 'b']);
    expect(s).toEqual({ ids: ['c', 'e', 'a', 'd', 'b'], index: 0, original: ['a', 'b', 'c', 'd', 'e'] });
    const added = playNext(addToQueue(s, ['x']), ['y']);
    expect(added.ids).toEqual(['c', 'y', 'e', 'a', 'd', 'b', 'x']);
    const playing = jumpTo(added, 4);
    expect(current(playing)).toBe('d');
    expect(shuffleOff(playing)).toEqual({ ids: ['a', 'b', 'c', 'd', 'e', 'x', 'y'], index: 3, original: null });
  });

  it('forgets removed items, keeps the first original and ignores no-ops', () => {
    const s = shuffleOn(q, ['c', 'e', 'a', 'd', 'b']);
    expect(shuffleOff(removeAt(s, 1))).toEqual({ ids: ['a', 'b', 'c', 'd'], index: 2, original: null });
    expect(shuffleOn(s, ['c', 'b', 'd', 'a', 'e']).original).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(shuffleOff(clearUpcoming(s))).toEqual({ ids: ['c'], index: 0, original: null });
    expect(shuffleOff(q)).toBe(q);
  });

  it('finds the current item when the shuffle did not put it first', () => {
    const s = shuffleOn(q, ['e', 'a', 'c', 'b', 'd']);
    expect(current(s)).toBe('c');
  });

  it('restores duplicates queued while shuffled', () => {
    const s = shuffleOn(makeQueue(['a', 'b', 'c'], 0), ['a', 'c', 'b']);
    const withDup = jumpTo(playNext(s, ['b']), 1);
    expect(current(withDup)).toBe('b');
    const off = shuffleOff(withDup);
    expect(off.ids).toEqual(['a', 'b', 'c', 'b']);
    expect(current(off)).toBe('b');
    expect(upcoming(off)).toEqual(['c', 'b']);
  });
});
