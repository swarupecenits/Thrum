import { hashString } from '../../../../src/lib/random';
import type { RawTrack, TagResult } from '../ThrumAudio.types';
import { demoLibrary, findTrack } from './library';
import { lyricsFor } from './lyrics';
import { round } from './util';

/** TagReader.codecOf for the formats a phone library realistically holds. */
const MIME_CODECS: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/flac': 'FLAC',
  'audio/x-flac': 'FLAC',
  'audio/mp4': 'AAC',
  'audio/x-m4a': 'AAC',
  'audio/aac': 'AAC',
  'audio/mp4a-latm': 'AAC',
  'audio/opus': 'Opus',
  'audio/ogg': 'Vorbis',
  'audio/wav': 'PCM',
  'audio/x-wav': 'PCM',
};

const EXT_CODECS: Record<string, string> = {
  mp3: 'MP3',
  flac: 'FLAC',
  m4a: 'AAC',
  aac: 'AAC',
  opus: 'Opus',
  ogg: 'Vorbis',
  wav: 'PCM',
};

const LOSSLESS = new Set(['FLAC', 'ALAC', 'PCM']);

const EMPTY: TagResult = {
  lyrics: null,
  synced: false,
  replayGainTrackDb: null,
  replayGainAlbumDb: null,
  replayGainPeak: null,
  sampleRate: null,
  channels: null,
  bitDepth: null,
  codec: null,
  bitrate: null,
};

function codecOf(t: RawTrack): string | null {
  const hit = MIME_CODECS[t.mime.toLowerCase()];
  if (hit) return hit;
  const ext = /\.([a-z0-9]+)$/i.exec(t.fileName)?.[1]?.toLowerCase();
  return (ext && EXT_CODECS[ext]) || null;
}

/** MediaStore's bitrate, else estimated from the file size like TagReader does from the audio bytes. */
function bitrateOf(t: RawTrack): number | null {
  const bps = t.bitrate > 0 ? t.bitrate : t.durationMs > 0 ? (t.size * 8000) / t.durationMs : 0;
  return bps >= 1000 && bps < 100_000_000 ? Math.round(bps) : null;
}

type ReplayGain = Pick<TagResult, 'replayGainTrackDb' | 'replayGainAlbumDb' | 'replayGainPeak'>;

/** ReplayGain as a tagger would have written it: -18 LUFS reference, album gain from the album mean. */
function replayGain(t: RawTrack, codec: string | null): ReplayGain {
  const lib = demoLibrary();
  const own = lib.features[t.id];
  const tagged = codec === 'FLAC' || codec === 'AAC' || hashString(t.albumId || t.album) % 2 === 0;
  if (!own || !tagged) return { replayGainTrackDb: null, replayGainAlbumDb: null, replayGainPeak: null };
  const album = lib.raw.filter((r) => r.album === t.album && r.albumId === t.albumId && lib.features[r.id]);
  const mean = album.reduce((sum, r) => sum + (lib.features[r.id]?.loudnessLufs ?? 0), 0) / (album.length || 1);
  return {
    replayGainTrackDb: round(-18 - own.loudnessLufs, 2),
    replayGainAlbumDb: round(-18 - mean, 2),
    replayGainPeak: own.peak,
  };
}

export function tagsFor(id: string): TagResult {
  const t = findTrack(id);
  if (!t) return { ...EMPTY };
  const codec = codecOf(t);
  const lossless = codec !== null && LOSSLESS.has(codec);
  const hiRes = lossless && t.bitrate >= 900_000;
  const lyrics = lyricsFor(t);
  return {
    ...EMPTY,
    ...replayGain(t, codec),
    lyrics: lyrics?.text ?? null,
    synced: lyrics?.synced ?? false,
    sampleRate: codec ? (hiRes ? 48_000 : 44_100) : null,
    channels: codec ? 2 : null,
    bitDepth: lossless ? (hiRes ? 24 : 16) : null,
    codec,
    bitrate: bitrateOf(t),
  };
}
