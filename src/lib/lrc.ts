export type LyricLine = { timeMs: number; text: string };

export type Lyrics = { synced: boolean; lines: LyricLine[]; meta: Record<string, string> };

const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const LEADING_TAGS = /^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/;
const META_TAG = /^\s*\[([a-z#]+)\s*:([^\]]*)\]\s*$/i;
const META_KEYS = new Set([
  'ar', 'al', 'ti', 'au', 'by', 'offset', 're', 've', 'length', 'tool', 'la', 'lang', 'id', '#', 'lr', 'composer',
  'author', 'artist', 'album', 'title', 'language', 'sign', 'qq',
]);
const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;

function fractionMs(frac: string | undefined): number {
  if (!frac) return 0;
  // ".5" is 500 ms, ".25" is 250 ms, ".123" is 123 ms.
  return Math.round(Number(frac) * 10 ** (3 - frac.length));
}

function cleanText(s: string): string {
  return s.replace(WORD_TAG, '').replace(/\s+/g, ' ').trim();
}

/**
 * Parses LRC (several timestamps per line, `[offset:]`, metadata, enhanced `<mm:ss.xx>` word tags)
 * or plain lyrics (synced false, timeMs -1). Returns null when there is nothing to show.
 */
export function parseLyrics(text: string | null | undefined): Lyrics | null {
  if (!text || !text.trim()) return null;
  const meta: Record<string, string> = {};
  const timed: (LyricLine & { order: number })[] = [];
  const plain: string[] = [];
  let order = 0;
  for (const raw of text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/)) {
    const lead = LEADING_TAGS.exec(raw);
    if (lead) {
      const body = cleanText(lead[2]);
      TIME_TAG.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = TIME_TAG.exec(lead[1]))) {
        const ms = (Number(m[1]) * 60 + Number(m[2])) * 1000 + fractionMs(m[3]);
        timed.push({ timeMs: ms, text: body, order: order++ });
      }
      continue;
    }
    const tag = META_TAG.exec(raw);
    if (tag && META_KEYS.has(tag[1].toLowerCase())) {
      meta[tag[1].toLowerCase()] = tag[2].trim();
      continue;
    }
    const line = cleanText(raw);
    if (line) plain.push(line);
  }
  if (timed.length) {
    const offset = Number.parseInt(meta.offset ?? '', 10);
    // A positive offset makes lyrics appear sooner.
    const shift = Number.isFinite(offset) ? offset : 0;
    const lines = timed
      .map((l) => ({ ...l, timeMs: Math.max(0, l.timeMs - shift) }))
      .sort((a, b) => a.timeMs - b.timeMs || a.order - b.order)
      .map(({ timeMs, text: t }) => ({ timeMs, text: t }));
    if (lines.every((l) => !l.text)) return null;
    return { synced: true, lines, meta };
  }
  if (!plain.length) return null;
  return { synced: false, lines: plain.map((t) => ({ timeMs: -1, text: t })), meta };
}

/** Index of the line being sung at `positionMs`; -1 before the first line or for unsynced lyrics. */
export function activeLine(lines: LyricLine[], positionMs: number): number {
  if (!lines.length || lines[0].timeMs < 0 || !(positionMs >= lines[0].timeMs)) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].timeMs <= positionMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
