import { hashString } from './random';
import { DAY_MS, HOUR_MS, MINUTE_MS, dayIndex } from './time';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "3:07", "1:02:03"; negative or invalid -> "0:00". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** "45 min", "2 hr 14 min", "1 hr". Anything above zero is at least "1 min". */
export function formatTotalDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 min';
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/** "4 Mar", or "4 Mar 2023" when not in the reference year. */
export function formatShortDate(ts: number, now: number): string {
  const d = new Date(ts);
  const base = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === new Date(now).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "just now", "5 min ago", "3 hr ago", "yesterday", "3 days ago", "2 weeks ago", then a short date. */
export function formatRelative(ts: number, now: number): string {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return '';
  const diff = now - ts;
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} min ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} hr ago`;
  const days = Math.max(1, dayIndex(now) - dayIndex(ts));
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  }
  return formatShortDate(ts, now);
}

/** Gains for sound controls: "+3.5 dB", "0 dB", "−2 dB" (true minus sign, at most one decimal). */
export function formatDb(db: number): string {
  if (!Number.isFinite(db)) return '0 dB';
  const r = Math.round(db * 10) / 10;
  if (r === 0) return '0 dB';
  const text = Number.isInteger(r) ? String(Math.abs(r)) : Math.abs(r).toFixed(1);
  return `${r > 0 ? '+' : '\u2212'}${text} dB`;
}

/** 1204 -> "1,204". */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const digits = String(Math.round(Math.abs(n)));
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return n < 0 && out !== '0' ? `-${out}` : out;
}

function pluralize(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

/** "1 song", "12 songs", "1,204 songs". */
export function formatCount(n: number, singular: string, plural?: string): string {
  const v = Number.isFinite(n) ? Math.round(n) : 0;
  return `${formatNumber(v)} ${v === 1 ? singular : (plural ?? pluralize(singular))}`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1024-based: "512 B", "8.4 MB", "1.2 GB". */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  let v = n;
  let u = 0;
  while (v >= 1024 && u < BYTE_UNITS.length - 1) {
    v /= 1024;
    u++;
  }
  let digits = u === 0 || v >= 100 ? 0 : 1;
  let text = v.toFixed(digits);
  if (Number(text) >= 1024 && u < BYTE_UNITS.length - 1) {
    v /= 1024;
    u++;
    digits = 1;
    text = v.toFixed(digits);
  }
  return `${text.replace(/\.0$/, '')} ${BYTE_UNITS[u]}`;
}

const MIME_CODECS: Record<string, string> = {
  'audio/mpeg': 'MP3',
  'audio/mp3': 'MP3',
  'audio/mpeg3': 'MP3',
  'audio/x-mpeg': 'MP3',
  'audio/x-mp3': 'MP3',
  'audio/mpa': 'MP3',
  'audio/flac': 'FLAC',
  'audio/x-flac': 'FLAC',
  'audio/mp4': 'AAC',
  'audio/m4a': 'AAC',
  'audio/x-m4a': 'AAC',
  'audio/aac': 'AAC',
  'audio/x-aac': 'AAC',
  'audio/aacp': 'AAC',
  'audio/mp4a-latm': 'AAC',
  'audio/ogg': 'OGG',
  'audio/x-ogg': 'OGG',
  'audio/vorbis': 'OGG',
  'application/ogg': 'OGG',
  'audio/opus': 'Opus',
  'audio/wav': 'WAV',
  'audio/x-wav': 'WAV',
  'audio/wave': 'WAV',
  'audio/vnd.wave': 'WAV',
  'audio/amr': 'AMR',
  'audio/amr-wb': 'AMR',
  'audio/x-ms-wma': 'WMA',
  'audio/aiff': 'AIFF',
  'audio/x-aiff': 'AIFF',
  'audio/alac': 'ALAC',
  'audio/ape': 'APE',
  'audio/x-ape': 'APE',
  'audio/x-wavpack': 'WavPack',
  'audio/x-matroska': 'MKA',
  'audio/webm': 'WebM',
  'audio/midi': 'MIDI',
  'audio/x-midi': 'MIDI',
};

const EXT_CODECS: Record<string, string> = {
  mp3: 'MP3',
  flac: 'FLAC',
  m4a: 'AAC',
  m4b: 'AAC',
  mp4: 'AAC',
  aac: 'AAC',
  '3gp': 'AAC',
  ogg: 'OGG',
  oga: 'OGG',
  opus: 'Opus',
  wav: 'WAV',
  wave: 'WAV',
  amr: 'AMR',
  awb: 'AMR',
  wma: 'WMA',
  aif: 'AIFF',
  aiff: 'AIFF',
  alac: 'ALAC',
  ape: 'APE',
  wv: 'WavPack',
  mka: 'MKA',
  webm: 'WebM',
  mid: 'MIDI',
  midi: 'MIDI',
  dsf: 'DSD',
  dff: 'DSD',
};

/** Short codec name from a MIME type, falling back to the file extension, else "Audio". */
export function codecFromMime(mime: string, fileName?: string): string {
  const full = (mime || '').toLowerCase();
  if (full.includes('opus')) return 'Opus';
  const hit = MIME_CODECS[full.split(';')[0].trim()];
  if (hit) return hit;
  const ext = /\.([a-z0-9]+)$/i.exec(fileName ?? '')?.[1]?.toLowerCase();
  if (ext && EXT_CODECS[ext]) return EXT_CODECS[ext];
  return 'Audio';
}

function codecFromTag(codec: string | null | undefined): string | null {
  if (!codec) return null;
  const c = codec.toLowerCase();
  if (c.includes('alac')) return 'ALAC';
  if (c.includes('flac')) return 'FLAC';
  if (c.includes('opus')) return 'Opus';
  if (c.includes('vorbis') || c === 'ogg') return 'OGG';
  if (c.includes('aac') || c.includes('mp4a')) return 'AAC';
  if (c.includes('mp3') || c.includes('mpga') || c.includes('layer 3') || c.includes('layer iii')) return 'MP3';
  if (c.includes('pcm') || c.includes('wav')) return 'WAV';
  if (c.includes('aiff')) return 'AIFF';
  if (c.includes('wavpack')) return 'WavPack';
  if (c.includes('monkey') || c === 'ape') return 'APE';
  if (c.includes('dsd') || c.includes('dsf')) return 'DSD';
  if (c.includes('amr')) return 'AMR';
  if (c.includes('wma')) return 'WMA';
  return null;
}

const LOSSLESS = new Set(['FLAC', 'ALAC', 'WAV', 'AIFF', 'APE', 'WavPack', 'DSD']);

function toKbps(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  // Values below 4000 are already kbps; MediaStore reports bits per second.
  return Math.round(v < 4000 ? v : v / 1000);
}

function formatRate(hz: number): string {
  return `${Math.round(hz / 100) / 10} kHz`;
}

/** Codec + human detail ("24-bit · 96 kHz", "320 kbps", "44.1 kHz") for the now-playing quality badge. */
export function qualityLabel(
  t: { mime: string; fileName?: string; bitrate: number | null },
  tags?: { sampleRate?: number | null; bitDepth?: number | null; codec?: string | null; bitrate?: number | null } | null,
): { codec: string; detail: string; lossless: boolean; hiRes: boolean } {
  const codec = codecFromTag(tags?.codec) ?? codecFromMime(t.mime, t.fileName);
  const lossless = LOSSLESS.has(codec);
  const rate = tags?.sampleRate != null && tags.sampleRate > 0 ? tags.sampleRate : null;
  const depth = tags?.bitDepth != null && tags.bitDepth > 0 ? tags.bitDepth : null;
  const kbps = toKbps(tags?.bitrate) ?? toKbps(t.bitrate);
  let detail: string;
  if (lossless) {
    const parts: string[] = [];
    if (depth) parts.push(`${depth}-bit`);
    if (rate) parts.push(formatRate(rate));
    detail = parts.length ? parts.join(' · ') : kbps ? `${kbps} kbps` : '';
  } else {
    detail = kbps ? `${kbps} kbps` : rate ? formatRate(rate) : '';
  }
  const hiRes = lossless && ((rate ?? 0) > 48000 || (depth ?? 0) > 16);
  return { codec, detail, lossless, hiRes };
}

type GreetingPart = 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night' | 'latenight';

const GREETING_LINES: Record<GreetingPart, string[]> = {
  dawn: [
    'Early start. Ease into it.',
    'Chai first, then the good stuff.',
    'Quiet streets, soft tunes.',
    "The world's still loading. You're not.",
  ],
  morning: [
    'Something bright to get going.',
    'Fresh day, fresh queue.',
    "Let's find today's rhythm.",
    "Coffee's on. So is the bass.",
  ],
  afternoon: [
    "Post-lunch slump? There's a beat for that.",
    'Headphones on, world off.',
    'A little focus, a little groove.',
    'Halfway there. Keep it moving.',
  ],
  evening: [
    'Golden hour deserves a soundtrack.',
    'Shake off the day.',
    'The commute just got better.',
    'Time to turn it up a notch.',
  ],
  night: [
    'Lights low, bass up.',
    'Wind down or turn up. Your call.',
    "The night's young. So is the queue.",
    'Slow songs and city lights.',
  ],
  latenight: [
    'The best songs come out after midnight.',
    'Just you, the night and the low end.',
    'Keep it low, the neighbours are asleep.',
    'Late-night thoughts need late-night tracks.',
  ],
};

function greetingPart(hour: number): GreetingPart {
  if (hour < 5) return 'latenight';
  if (hour < 8) return 'dawn';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function specialLines(weekday: number, part: GreetingPart): string[] {
  const morningish = part === 'dawn' || part === 'morning';
  const nightish = part === 'evening' || part === 'night';
  if (weekday === 1 && morningish) return ["Monday again. Let's make it sound better."];
  if (weekday === 5 && nightish) return ["It's Friday. You know what to do.", 'Weekend loading…'];
  if (weekday === 6 && morningish) return ['No alarms today. Just music.'];
  if (weekday === 6 && nightish) return ['Saturday night. Bass is mandatory.'];
  if (weekday === 0 && part !== 'latenight') return ['Slow Sunday, slower songs.', 'Sunday reset, one song at a time.'];
  return [];
}

/** Home-screen greeting; the subtitle varies by daypart and weekday but is stable within an hour. */
export function greeting(date: Date, name?: string): { title: string; subtitle: string } {
  const hour = date.getHours();
  const part = greetingPart(hour);
  const first = (name ?? '').trim().split(/\s+/)[0] ?? '';
  let title: string;
  if (part === 'latenight') title = first ? `Still up, ${first}?` : 'Still up?';
  else {
    const hello = part === 'dawn' || part === 'morning' ? 'Good morning' : part === 'afternoon' ? 'Good afternoon' : 'Good evening';
    title = first ? `${hello}, ${first}` : hello;
  }
  const seed = hashString(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${hour}`);
  const specials = specialLines(date.getDay(), part);
  const lines = specials.length && seed % 2 === 0 ? specials : GREETING_LINES[part];
  return { title, subtitle: lines[Math.floor(seed / 2) % lines.length] };
}
