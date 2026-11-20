import { activeLine, parseLyrics } from '../lrc';

describe('parseLyrics', () => {
  it('parses LRC with metadata, repeated timestamps, offsets and breaks', () => {
    const lrc = [
      '[ti:Test Song]',
      '[ar:Test Artist]',
      '[offset:+500]',
      '',
      '[00:12.34]First line',
      '[00:20.5][01:05.00]Chorus line',
      '[00:30]',
      '[00:31.123]Second verse',
    ].join('\r\n');
    const l = parseLyrics(lrc);
    expect(l?.synced).toBe(true);
    expect(l?.meta).toEqual({ ti: 'Test Song', ar: 'Test Artist', offset: '+500' });
    expect(l?.lines).toEqual([
      { timeMs: 11840, text: 'First line' },
      { timeMs: 20000, text: 'Chorus line' },
      { timeMs: 29500, text: '' },
      { timeMs: 30623, text: 'Second verse' },
      { timeMs: 64500, text: 'Chorus line' },
    ]);
  });

  it('applies negative offsets and clamps at zero', () => {
    expect(parseLyrics('[offset:-250]\n[00:01.00]One')?.lines).toEqual([{ timeMs: 1250, text: 'One' }]);
    expect(parseLyrics('[offset:2000]\n[00:01.00]One')?.lines).toEqual([{ timeMs: 0, text: 'One' }]);
  });

  it('strips enhanced word tags and accepts other timestamp shapes', () => {
    const l = parseLyrics('\ufeff[00:05.00]<00:05.00>Ek <00:05.40>do <00:05.80>teen\r[01:02:03]Colon fraction\n[02:03.4]Tenths');
    expect(l?.lines).toEqual([
      { timeMs: 5000, text: 'Ek do teen' },
      { timeMs: 62030, text: 'Colon fraction' },
      { timeMs: 123400, text: 'Tenths' },
    ]);
  });

  it('sorts by time and keeps file order for equal times', () => {
    const l = parseLyrics('[00:09.00]Later\n[00:03.00]Early A\n[00:03.00]Early B');
    expect(l?.lines.map((x) => x.text)).toEqual(['Early A', 'Early B', 'Later']);
  });

  it('treats untimed text as plain lyrics', () => {
    const l = parseLyrics('[ar:Someone]\r\nLine one\r\n\r\n  Line   two  \n[Chorus]\nLine three');
    expect(l).toEqual({
      synced: false,
      meta: { ar: 'Someone' },
      lines: [
        { timeMs: -1, text: 'Line one' },
        { timeMs: -1, text: 'Line two' },
        { timeMs: -1, text: '[Chorus]' },
        { timeMs: -1, text: 'Line three' },
      ],
    });
  });

  it('returns null when there is nothing to show', () => {
    expect(parseLyrics(null)).toBeNull();
    expect(parseLyrics(undefined)).toBeNull();
    expect(parseLyrics('')).toBeNull();
    expect(parseLyrics('  \r\n \n')).toBeNull();
    expect(parseLyrics('[ar:Someone]\n[ti:Song]')).toBeNull();
    expect(parseLyrics('[00:01.00]\n[00:02.00]')).toBeNull();
  });
});

describe('activeLine', () => {
  const lines = [
    { timeMs: 1000, text: 'a' },
    { timeMs: 5000, text: 'b' },
    { timeMs: 5000, text: 'c' },
    { timeMs: 9000, text: 'd' },
  ];

  it('finds the line being sung', () => {
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 999)).toBe(-1);
    expect(activeLine(lines, 1000)).toBe(0);
    expect(activeLine(lines, 4999)).toBe(0);
    expect(activeLine(lines, 5000)).toBe(2);
    expect(activeLine(lines, 8999)).toBe(2);
    expect(activeLine(lines, 9000)).toBe(3);
    expect(activeLine(lines, 1e9)).toBe(3);
  });

  it('returns -1 for empty, unsynced or invalid input', () => {
    expect(activeLine([], 100)).toBe(-1);
    expect(activeLine([{ timeMs: -1, text: 'plain' }], 100)).toBe(-1);
    expect(activeLine(lines, Number.NaN)).toBe(-1);
  });
});
