import {
  codecFromMime,
  formatBytes,
  formatCount,
  formatDb,
  formatDuration,
  formatRelative,
  formatTotalDuration,
  greeting,
  qualityLabel,
} from '../format';
import { local } from './fixtures';

describe('durations', () => {
  it('formats track lengths', () => {
    expect(formatDuration(187_000)).toBe('3:07');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(59_999)).toBe('0:59');
    expect(formatDuration(-1)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('formats totals', () => {
    expect(formatTotalDuration(45 * 60_000)).toBe('45 min');
    expect(formatTotalDuration((2 * 60 + 14) * 60_000)).toBe('2 hr 14 min');
    expect(formatTotalDuration(3_600_000)).toBe('1 hr');
    expect(formatTotalDuration(20_000)).toBe('1 min');
    expect(formatTotalDuration(0)).toBe('0 min');
  });
});

describe('formatRelative', () => {
  const now = local(2025, 3, 10, 15);
  it.each([
    [now - 10_000, 'just now'],
    [now - 5 * 60_000, '5 min ago'],
    [now - 3 * 3_600_000, '3 hr ago'],
    [local(2025, 3, 9, 10), 'yesterday'],
    [local(2025, 3, 7, 12), '3 days ago'],
    [local(2025, 2, 24, 12), '2 weeks ago'],
    [local(2025, 1, 4, 12), '4 Jan'],
    [local(2023, 3, 4, 12), '4 Mar 2023'],
  ])('%s -> %s', (ts, expected) => {
    expect(formatRelative(ts, now)).toBe(expected);
  });
});

describe('counts and sizes', () => {
  it('pluralizes and groups thousands', () => {
    expect(formatCount(1, 'song')).toBe('1 song');
    expect(formatCount(12, 'song')).toBe('12 songs');
    expect(formatCount(1204, 'song')).toBe('1,204 songs');
    expect(formatCount(0, 'album')).toBe('0 albums');
    expect(formatCount(3, 'category')).toBe('3 categories');
    expect(formatCount(2, 'person', 'people')).toBe('2 people');
  });

  it('formats gains with a sign and at most one decimal', () => {
    expect(formatDb(3.5)).toBe('+3.5 dB');
    expect(formatDb(6)).toBe('+6 dB');
    expect(formatDb(-2)).toBe('\u22122 dB');
    expect(formatDb(0.04)).toBe('0 dB');
    expect(formatDb(-0.04)).toBe('0 dB');
    expect(formatDb(Number.NaN)).toBe('0 dB');
  });

  it('formats bytes in binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(8.4 * 1024 * 1024)).toBe('8.4 MB');
    expect(formatBytes(2 * 1024 ** 3)).toBe('2 GB');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('codecs and quality', () => {
  it.each([
    ['audio/mpeg', undefined, 'MP3'],
    ['audio/flac', undefined, 'FLAC'],
    ['audio/mp4', undefined, 'AAC'],
    ['audio/x-m4a', undefined, 'AAC'],
    ['audio/aac', undefined, 'AAC'],
    ['audio/ogg', undefined, 'OGG'],
    ['audio/ogg; codecs=opus', undefined, 'Opus'],
    ['audio/x-wav', undefined, 'WAV'],
    ['audio/amr', undefined, 'AMR'],
    ['audio/x-ms-wma', undefined, 'WMA'],
    ['audio/aiff', undefined, 'AIFF'],
    ['application/octet-stream', 'Kesariya.flac', 'FLAC'],
    ['', 'track.m4a', 'AAC'],
    ['', 'noext', 'Audio'],
  ])('%s (%s) -> %s', (mime, file, expected) => {
    expect(codecFromMime(mime, file)).toBe(expected);
  });

  it('describes lossless, hi-res and lossy files', () => {
    expect(qualityLabel({ mime: 'audio/flac', bitrate: 2_100_000 }, { sampleRate: 96000, bitDepth: 24 })).toEqual({
      codec: 'FLAC',
      detail: '24-bit · 96 kHz',
      lossless: true,
      hiRes: true,
    });
    expect(qualityLabel({ mime: 'audio/flac', bitrate: 900_000 }, { sampleRate: 44100, bitDepth: 16 })).toMatchObject({
      detail: '16-bit · 44.1 kHz',
      hiRes: false,
    });
    expect(qualityLabel({ mime: 'audio/mpeg', bitrate: 320_000 })).toEqual({
      codec: 'MP3',
      detail: '320 kbps',
      lossless: false,
      hiRes: false,
    });
    expect(qualityLabel({ mime: 'audio/mp4', bitrate: null }, { sampleRate: 44100 }).detail).toBe('44.1 kHz');
    expect(qualityLabel({ mime: 'audio/mp4', bitrate: null }, { codec: 'alac', sampleRate: 48000, bitDepth: 24 })).toMatchObject({
      codec: 'ALAC',
      lossless: true,
      hiRes: true,
    });
  });
});

describe('greeting', () => {
  it('greets by daypart with the first name', () => {
    expect(greeting(new Date(2025, 2, 12, 9), 'Swarup Chanda').title).toBe('Good morning, Swarup');
    expect(greeting(new Date(2025, 2, 12, 14)).title).toBe('Good afternoon');
    expect(greeting(new Date(2025, 2, 12, 19, 30), 'Swarup').title).toBe('Good evening, Swarup');
    expect(greeting(new Date(2025, 2, 12, 2), 'Swarup').title).toBe('Still up, Swarup?');
  });

  it('keeps the subtitle stable within an hour and varies it over the day', () => {
    expect(greeting(new Date(2025, 2, 14, 19, 5)).subtitle).toBe(greeting(new Date(2025, 2, 14, 19, 55)).subtitle);
    const lines = new Set<string>();
    for (let h = 0; h < 24; h++) lines.add(greeting(new Date(2025, 2, 12, h)).subtitle);
    expect(lines.size).toBeGreaterThan(5);
    for (const line of lines) expect(line.length).toBeGreaterThan(0);
  });
});
