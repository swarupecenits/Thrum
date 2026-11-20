import { pairScore, pointOf } from './features';
import { artistIdOf, primaryArtist } from './library';
import {
  GENRE_FAMILIES,
  MOODS,
  bpmCloseness,
  familyCandidates,
  isBassyFamily,
  keywordMoods,
  moodById,
  moodScore,
  rangeCloseness,
} from './moods';
import { compareKeys, normalize, scoreNormalized, sortKey, tokenScore, tokens } from './text';
import { DAY_MS } from './time';
import type {
  Features,
  Library,
  MoodId,
  PersonalFilter,
  Range,
  ScoredTrack,
  Track,
  TrackStat,
  VibeChip,
  VibeContext,
  VibeQuery,
} from './types';

type Concept =
  | { kind: 'mood'; mood: MoodId }
  | { kind: 'genre'; families: string[]; label: string }
  | { kind: 'energy' | 'valence' | 'tempo' | 'duration'; range: Range; label: string }
  | { kind: 'era'; range: (nowYear: number) => Range; label: string }
  | { kind: 'bass' }
  | { kind: 'personal'; filter: PersonalFilter }
  | { kind: 'like' }
  | { kind: 'stop' };

const MAX_DURATION_MS = 36_000_000;

export const PERSONAL_LABELS: Record<PersonalFilter, string> = {
  favorites: 'Favourites',
  'most-played': 'Most played',
  recent: 'Recently played',
  forgotten: 'Rediscover',
  new: 'Recently added',
  'never-played': 'Never played',
};

const DICT = new Map<string, Concept[]>();

/** Registers phrases; the first registration of a phrase wins (personal > bass > ranges > moods > genres > stop). */
function def(phrases: string[], ...concepts: Concept[]): void {
  for (const p of phrases) {
    const key = normalize(p);
    if (key && !DICT.has(key)) DICT.set(key, concepts);
  }
}

const personal = (filter: PersonalFilter, phrases: string[]) => def(phrases, { kind: 'personal', filter });
personal('most-played', ['most played', 'most listened', 'most heard', 'played the most', 'my top', 'top', 'top songs', 'top tracks', 'on repeat', 'heavy rotation']);
personal('recent', ['recently played', 'played recently', 'recent', 'recents', 'lately', 'last played', 'recently listened']);
personal('forgotten', [
  "haven't heard", 'havent heard', 'not heard', "haven't listened", 'havent listened', 'not listened', "haven't played",
  'havent played', 'not played in', 'in a while', 'in ages', 'in a long time', 'long time', 'forgotten', 'forgot',
  'rediscover', 'rediscovery',
]);
personal('new', ['new', 'recently added', 'just added', 'newly added', 'added recently', 'new additions', 'fresh', 'freshly added']);
personal('favorites', ['favourites', 'favorites', 'favourite', 'favorite', 'faves', 'favs', 'fav', 'fave', 'liked', 'liked songs', 'loved', 'hearted']);
personal('never-played', ['never played', 'unplayed', 'never heard', 'not played', 'unheard', 'never listened']);

def(
  [
    'bass', 'bassy', 'bass heavy', 'heavy bass', 'bass boosted', 'deep bass', 'thump', 'thumping', 'thumpy', '808',
    '808s', 'boom', 'subwoofer', 'sub bass', 'low end', 'bass drop', 'more bass', 'extra bass', 'dhol', 'bassline',
  ],
  { kind: 'bass' },
);

const range = (kind: 'energy' | 'valence' | 'tempo', lo: number, hi: number, label: string, phrases: string[]) =>
  def(phrases, { kind, range: [lo, hi], label });
range('tempo', 125, 220, 'Fast', ['fast', 'faster', 'quick tempo', 'high tempo', 'high bpm', 'speedy']);
range('tempo', 0, 95, 'Slow', ['slow', 'slower', 'low tempo', 'low bpm', 'slow tempo']);
range('tempo', 95, 125, 'Mid-tempo', ['mid tempo', 'midtempo', 'medium tempo', 'medium', 'mid']);
range('energy', 0.6, 1, 'Upbeat', ['upbeat', 'up beat', 'peppy', 'lively', 'bouncy']);
range('energy', 0.7, 1, 'High energy', ['high energy', 'full energy', 'high octane']);
range('energy', 0, 0.4, 'Low energy', ['low energy', 'low key', 'lowkey', 'low-key']);
range('energy', 0.7, 1, 'Loud', ['loud', 'louder', 'noisy', 'blasting']);
range('energy', 0.75, 1, 'Intense', ['intense', 'heavy', 'aggressive', 'hard hitting', 'hardcore']);
range('energy', 0, 0.4, 'Soft', ['soft', 'softer', 'gentle', 'tender', 'delicate']);
range('energy', 0, 0.35, 'Quiet', ['quiet', 'quieter', 'hushed', 'silent']);
range('valence', 0, 0.4, 'Dark', ['dark', 'darker', 'gloomy', 'grim', 'sinister']);
range('valence', 0, 0.45, 'Moody', ['moody', 'brooding']);
range('valence', 0.6, 1, 'Bright', ['bright', 'cheery', 'sunny side']);

const era = (lo: number | ((y: number) => number), hi: number | ((y: number) => number), label: string, phrases: string[]) =>
  def(phrases, {
    kind: 'era',
    range: (y) => [typeof lo === 'number' ? lo : lo(y), typeof hi === 'number' ? hi : hi(y)],
    label,
  });
era(1900, 1999, 'Oldies', ['old', 'oldies', 'old songs', 'retro', 'purane', 'purana', 'purani', 'evergreen', 'classics', 'golden era', 'golden oldies', 'old school', 'vintage', 'throwback', 'throwbacks']);
era((y) => y - 1, (y) => y, 'Latest', ['latest', 'newest', 'brand new']);
era((y) => y, (y) => y, 'This year', ['this year']);
era((y) => y - 1, (y) => y - 1, 'Last year', ['last year']);
era(1950, 1959, '1950s', ['fifties']);
era(1960, 1969, '1960s', ['sixties']);
era(1970, 1979, '1970s', ['seventies']);
era(1980, 1989, '1980s', ['eighties']);
era(1990, 1999, '1990s', ['nineties']);

def(['short', 'shorter', 'quick', 'short songs', 'quickies'], { kind: 'duration', range: [0, 210_000], label: 'Short' });
def(['long', 'longer', 'long songs', 'lengthy', 'epic'], { kind: 'duration', range: [360_000, MAX_DURATION_MS], label: 'Long' });

// Combos: words that carry both a mood and a genre.
def(['bhangra'], { kind: 'mood', mood: 'party' }, { kind: 'genre', families: ['punjabi'], label: 'Punjabi' });
def(['sufi', 'qawwali', 'qawali', 'qawwalis'], { kind: 'mood', mood: 'devotional' }, { kind: 'genre', families: ['sufi'], label: 'Sufi' });
def(['long drive', 'night drive', 'late night drive'], { kind: 'mood', mood: 'drive' });

for (const m of MOODS) {
  if (m.id === 'bass') continue;
  def([m.label, ...m.synonyms], { kind: 'mood', mood: m.id });
}

const WESTERN = ['pop', 'rock', 'rnb', 'hiphop', 'edm', 'indie', 'metal', 'country', 'jazz'];
const INDIAN = [
  'bollywood', 'punjabi', 'bengali', 'assamese', 'tamil', 'telugu', 'malayalam', 'kannada', 'marathi', 'gujarati',
  'bhojpuri', 'haryanvi', 'sufi', 'ghazal', 'devotional', 'hindustani', 'carnatic',
];
def(['english', 'western', 'international', 'angrezi'], { kind: 'genre', families: WESTERN, label: 'English' });
def(['indian', 'desi'], { kind: 'genre', families: INDIAN, label: 'Indian' });

// Genre aliases that read as ordinary words in a sentence ("theme", "world") stay plain text.
const AMBIGUOUS_ALIASES = new Set([
  'alt', 'theme', 'score', 'world', 'chart', 'piano', 'swing', 'drone', 'healing', 'relaxing', 'relaxation', 'musical',
  'religious', 'spiritual', 'worship', 'christian', 'chant', 'chants', 'garage', 'jungle', 'dub', 'orchestra', 'opera',
  'anime', 'urbano', 'latino', 'chill out', 'chillout',
]);
for (const f of GENRE_FAMILIES) {
  def(
    f.aliases.filter((a) => !AMBIGUOUS_ALIASES.has(a)),
    { kind: 'genre', families: [f.id], label: f.label },
  );
}

def(['like', 'similar to', 'similar', 'sounds like', 'sound like', 'more like', 'something like', 'just like', 'same as'], { kind: 'like' });

def(
  [
    'songs', 'song', 'music', 'tracks', 'track', 'tunes', 'some', 'for', 'me', 'play', 'playing', 'the', 'with', 'and',
    'or', 'i', 'want', 'wanna', 'need', 'something', 'vibes', 'vibe', 'vibey', 'stuff', 'my', 'by', 'a', 'an', 'of',
    'to', 'in', 'on', 'at', 'that', 'this', 'is', 'are', 'am', 'be', 'give', 'find', 'show', 'put', 'listen',
    'listening', 'hear', 'im', 'feeling', 'feel', 'mood', 'kind', 'kinda', 'type', 'sort', 'playlist', 'mix', 'list',
    'gaane', 'gaana', 'gane', 'gana', 'geet', 'bajao', 'chalao', 'sunao', 'laga', 'lagao', 'wale', 'wala', 'wali',
    'kuch', 'koi', 'mujhe', 'mere', 'mera', 'meri', 'chahiye', 'please', 'pls', 'plz', 'bro', 'yaar', 'really',
    'very', 'super', 'little', 'bit', 'just', 'more', 'less', 'only', 'all', 'any', 'from', 'since', 'until', 'till',
    'between', 'onwards', 'onward', 'pre', 'post', 'under', 'over', 'than', 'below', 'above', 'before', 'after',
    'up', 'within', 'least', 'most', 'max', 'minutes', 'minute', 'mins', 'min', 'while', 'time', 'now', 'today',
    'tonight', 'morning', 'afternoon', 'evening', 'weekend', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
    'saturday', 'sunday', 'era', 'decade', 'years', 'year', 'artist', 'artists', 'album', 'albums', 'genre', 'good',
    'best', 'great', 'nice', 'cool', 'perfect', 'ones', 'one', 'it', 'us', 'you', 'we', 'when', 'during', 'have', 'has',
    'had', 'havent', 'hasnt', 'not', 'dont', 'do', 'can', 'could', 'would', 'should', 'let', 'lets', 'get', 'got',
    'makes', 'make', 'made', 'which', 'what', 'too', 'so', 'also', 'hai',
  ],
  { kind: 'stop' },
);

const MAX_PHRASE = 4;

type Hit = { chip: VibeChip; pos: number };
type State = { q: VibeQuery; hits: Hit[]; text: string[]; textRaw: string[]; textPos: number };
type Word = { w: string; start: number; end: number };

function emptyQuery(): VibeQuery {
  return {
    text: '',
    moods: [],
    energy: null,
    valence: null,
    bpm: null,
    bassHeavy: false,
    era: null,
    genres: [],
    personal: [],
    durationMs: null,
    similarTo: null,
    chips: [],
  };
}

/** Repeated constraints narrow each other; when they don't overlap the later one wins. */
function intersect(prev: Range | null, next: Range): Range {
  if (!prev) return next;
  const lo = Math.max(prev[0], next[0]);
  const hi = Math.min(prev[1], next[1]);
  return lo <= hi ? [lo, hi] : next;
}

function addChip(st: State, kind: VibeChip['kind'], label: string, source: string, pos: number): void {
  if (st.hits.some((h) => h.chip.kind === kind && h.chip.label === label)) return;
  st.hits.push({ chip: { kind, label, source: source.trim() }, pos });
}

function addEra(st: State, r: Range, label: string, source: string, pos: number): void {
  const e = st.q.era;
  // Several eras ("90s and 2000s") cover the span between them.
  st.q.era = e ? [Math.min(e[0], r[0]), Math.max(e[1], r[1])] : r;
  addChip(st, 'era', label, source, pos);
}

function apply(st: State, c: Concept, source: string, pos: number, nowYear: number): void {
  const q = st.q;
  switch (c.kind) {
    case 'mood':
      if (!q.moods.includes(c.mood)) q.moods.push(c.mood);
      addChip(st, 'mood', moodById(c.mood).label, source, pos);
      break;
    case 'genre':
      for (const f of c.families) if (!q.genres.includes(f)) q.genres.push(f);
      addChip(st, 'genre', c.label, source, pos);
      break;
    case 'energy':
      q.energy = intersect(q.energy, c.range);
      addChip(st, 'energy', c.label, source, pos);
      break;
    case 'valence':
      q.valence = intersect(q.valence, c.range);
      addChip(st, 'mood', c.label, source, pos);
      break;
    case 'tempo':
      q.bpm = intersect(q.bpm, c.range);
      addChip(st, 'tempo', c.label, source, pos);
      break;
    case 'duration':
      q.durationMs = intersect(q.durationMs, c.range);
      addChip(st, 'duration', c.label, source, pos);
      break;
    case 'era':
      addEra(st, c.range(nowYear), c.label, source, pos);
      break;
    case 'bass':
      q.bassHeavy = true;
      addChip(st, 'bass', 'Bass-heavy', source, pos);
      break;
    case 'personal':
      if (!q.personal.includes(c.filter)) q.personal.push(c.filter);
      addChip(st, 'personal', PERSONAL_LABELS[c.filter], source, pos);
      break;
    default:
      break;
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function durationLabel(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} hr`;
  if (ms % 60_000 === 0) return `${ms / 60_000} min`;
  if (ms < 60_000) return `${Math.round(ms / 1000)} sec`;
  return `${Math.floor(ms / 60_000)}:${pad2(Math.round((ms % 60_000) / 1000))}`;
}

type Rule = { re: RegExp; take: (m: RegExpExecArray, nowYear: number) => { era: boolean; range: Range; label: string } | null };

const UNDER = ['under', 'less than', 'shorter than', 'below', 'at most', 'max', 'maximum', 'up to', 'upto', 'within', 'no longer than'];
const OVER = ['over', 'more than', 'longer than', 'above', 'at least', 'minimum', 'min'];
const YEAR = '((?:19|20)\\d{2})';
const DECADE = "((?:19|20)?\\d0)'?s";

function decadeStart(s: string): number {
  const n = Number(s);
  if (s.length === 4) return n;
  return n >= 30 ? 1900 + n : 2000 + n;
}

const RULES: Rule[] = [
  {
    re: new RegExp(
      `\\b(${[...UNDER, ...OVER].map((w) => w.replace(/ /g, '\\s+')).join('|')})\\s+(\\d{1,3}(?::\\d{2})?)\\s*(minutes?|mins?|m|seconds?|secs?|sec|hours?|hrs?|hr|h)?(?![a-z0-9])`,
      'gi',
    ),
    take: (m) => {
      const n = m[2];
      const unit = (m[3] ?? '').toLowerCase();
      let ms: number;
      if (n.includes(':')) {
        const [mm, ss] = n.split(':').map(Number);
        ms = (mm * 60 + ss) * 1000;
      } else {
        const v = Number(n);
        // A bare number is minutes only when small ("under 4"); "up to 2005" is a year.
        if (!unit && v > 15) return null;
        ms = unit.startsWith('s') ? v * 1000 : unit.startsWith('h') ? v * 3_600_000 : v * 60_000;
      }
      if (!(ms > 0)) return null;
      const under = UNDER.includes(m[1].toLowerCase().replace(/\s+/g, ' '));
      return {
        era: false,
        range: under ? [0, ms] : [ms, MAX_DURATION_MS],
        label: `${under ? 'Under' : 'Over'} ${durationLabel(ms)}`,
      };
    },
  },
  {
    re: new RegExp(`\\b(?:between\\s+)?${YEAR}\\s*(?:-|\\u2013|\\u2014|to|and|till|until|through)\\s*${YEAR}\\b`, 'gi'),
    take: (m) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      return { era: true, range: [Math.min(a, b), Math.max(a, b)], label: `${Math.min(a, b)}\u2013${Math.max(a, b)}` };
    },
  },
  {
    re: new RegExp(`\\b(?:before|pre|older than|earlier than)[\\s-]*(?:the\\s+)?${DECADE}\\b`, 'gi'),
    take: (m) => {
      const d = decadeStart(m[1]);
      return { era: true, range: [1900, d - 1], label: `Before ${d}` };
    },
  },
  {
    re: new RegExp(`\\b(?:before|pre|older than|earlier than)[\\s-]*${YEAR}\\b`, 'gi'),
    take: (m) => ({ era: true, range: [1900, Number(m[1]) - 1], label: `Before ${m[1]}` }),
  },
  {
    re: new RegExp(`\\b(?:after|post|newer than|later than)[\\s-]*${YEAR}\\b`, 'gi'),
    take: (m, y) => ({ era: true, range: [Number(m[1]) + 1, Math.max(y, Number(m[1]) + 1)], label: `After ${m[1]}` }),
  },
  {
    re: new RegExp(`\\b(?:since|from|starting(?:\\s+from)?)\\s+${YEAR}\\b(?:\\s+(?:onwards?|and\\s+(?:up|later|after|newer)))?`, 'gi'),
    take: (m, y) => ({ era: true, range: [Number(m[1]), Math.max(y, Number(m[1]))], label: `Since ${m[1]}` }),
  },
  {
    re: new RegExp(`\\b${YEAR}\\s*(?:onwards?|and\\s+(?:up|later|after|newer)|\\+)`, 'gi'),
    take: (m, y) => ({ era: true, range: [Number(m[1]), Math.max(y, Number(m[1]))], label: `Since ${m[1]}` }),
  },
  {
    re: new RegExp(`\\b(?:until|till|til|up\\s*to|through|thru)\\s+${YEAR}\\b`, 'gi'),
    take: (m) => ({ era: true, range: [1900, Number(m[1])], label: `Up to ${m[1]}` }),
  },
  {
    re: new RegExp(`\\b(?:the\\s+)?${DECADE}\\b`, 'gi'),
    take: (m) => {
      const d = decadeStart(m[1]);
      return { era: true, range: [d, d + 9], label: `${d}s` };
    },
  },
  {
    re: new RegExp(`\\b${YEAR}\\b`, 'g'),
    take: (m, y) => (Number(m[1]) > y + 1 ? null : { era: true, range: [Number(m[1]), Number(m[1])], label: m[1] }),
  },
];

/** Durations and eras need punctuation ("3:30", "2005-2010"), so they're parsed before normalizing. */
function prePass(st: State, input: string, nowYear: number): string {
  let work = input;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    const found: { start: number; end: number; r: { era: boolean; range: Range; label: string } }[] = [];
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(work))) {
      const r = rule.take(m, nowYear);
      if (r) found.push({ start: m.index, end: m.index + m[0].length, r });
    }
    for (const f of found) {
      const source = input.slice(f.start, f.end);
      if (f.r.era) addEra(st, f.r.range, f.r.label, source, f.start);
      else {
        st.q.durationMs = intersect(st.q.durationMs, f.r.range);
        addChip(st, 'duration', f.r.label, source, f.start);
      }
      work = work.slice(0, f.start) + ' '.repeat(f.end - f.start) + work.slice(f.end);
    }
  }
  return work;
}

function splitWords(work: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(work))) {
    const n = normalize(m[0]);
    if (!n) continue;
    for (const w of n.split(' ')) out.push({ w, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

const titleCache = new WeakMap<Library, { t: Track; n: string }[]>();

function titleIndex(lib: Library): { t: Track; n: string }[] {
  let idx = titleCache.get(lib);
  if (!idx) {
    idx = lib.tracks.map((t) => ({ t, n: normalize(t.title) }));
    titleCache.set(lib, idx);
  }
  return idx;
}

function isStopWord(w: string): boolean {
  return DICT.get(w)?.[0]?.kind === 'stop';
}

/** Longest run of words after "like" that names a track title (score >= 0.75). */
function matchTitle(lib: Library, words: Word[], from: number): { track: Track; end: number } | null {
  const titles = titleIndex(lib);
  for (let n = Math.min(6, words.length - from); n >= 1; n--) {
    const run = words.slice(from, from + n);
    if (run.every((w) => isStopWord(w.w))) continue;
    const phrase = run.map((w) => w.w).join(' ');
    let best: Track | null = null;
    let bestScore = 0;
    for (const { t, n: title } of titles) {
      const s = scoreNormalized(phrase, title);
      if (s > bestScore) {
        best = t;
        bestScore = s;
      }
    }
    // A lone concept word ("like bass") only counts as a title when it is the whole title.
    const concept = n === 1 && DICT.has(phrase) && !isStopWord(phrase);
    if (best && bestScore >= (concept ? 1 : 0.75)) return { track: best, end: from + n };
  }
  return null;
}

/** Phone keyboards type curly apostrophes ("haven’t"); the dictionary and chip sources use straight ones. */
function straightQuotes(s: string): string {
  return (s ?? '').replace(/[\u2018\u2019\u201b`\u00b4\u02bc]/g, "'");
}

/**
 * Natural-language vibe search: "chill late night bass heavy 90s hindi", "songs like tum hi ho",
 * "most played arijit", "under 3 minutes". Unrecognized words are kept in `text`.
 */
export function parseVibe(input: string, now: Date = new Date(), lib?: Library): VibeQuery {
  const raw = straightQuotes(input);
  const nowYear = now.getFullYear();
  const st: State = { q: emptyQuery(), hits: [], text: [], textRaw: [], textPos: -1 };
  const words = splitWords(prePass(st, raw, nowYear));
  let i = 0;
  while (i < words.length) {
    let consumed = 0;
    for (let n = Math.min(MAX_PHRASE, words.length - i); n >= 1 && !consumed; n--) {
      const concepts = DICT.get(
        words
          .slice(i, i + n)
          .map((w) => w.w)
          .join(' '),
      );
      if (!concepts) continue;
      const start = words[i].start;
      if (concepts[0].kind === 'like') {
        const hit = lib ? matchTitle(lib, words, i + n) : null;
        if (hit) {
          st.q.similarTo = hit.track.id;
          addChip(st, 'similar', `Like: ${hit.track.title}`, raw.slice(start, words[hit.end - 1].end), start);
          consumed = hit.end - i;
          continue;
        }
      }
      const source = raw.slice(start, words[i + n - 1].end);
      for (const c of concepts) apply(st, c, source, start, nowYear);
      consumed = n;
    }
    if (!consumed) {
      const w = words[i];
      st.text.push(w.w);
      const rawWord = raw.slice(w.start, w.end);
      if (st.textRaw[st.textRaw.length - 1] !== rawWord) st.textRaw.push(rawWord);
      if (st.textPos < 0) st.textPos = w.start;
      consumed = 1;
    }
    i += consumed;
  }
  st.q.text = st.text.join(' ');
  if (st.text.length) addChip(st, 'text', st.textRaw.join(' '), st.textRaw.join(' '), st.textPos);
  st.q.chips = st.hits.sort((a, b) => a.pos - b.pos).map((h) => h.chip);
  return st.q;
}
const TEXT_WEIGHTS = [1, 0.9, 0.7, 0.5];
const fieldCache = new WeakMap<Track, string[][]>();

function trackFields(t: Track): string[][] {
  let f = fieldCache.get(t);
  if (!f) {
    f = [tokens(t.title), tokens(t.artists.join(' ')), tokens(t.album), tokens(t.genre)];
    fieldCache.set(t, f);
  }
  return f;
}

/** Mean of each word's best weighted token score; 0 when any word matches nothing. */
function textMatch(words: string[], t: Track): number {
  const fields = trackFields(t);
  let sum = 0;
  for (const w of words) {
    let best = 0;
    for (let i = 0; i < fields.length; i++) {
      for (const tok of fields[i]) {
        const s = tokenScore(w, tok) * TEXT_WEIGHTS[i];
        if (s > best) best = s;
      }
    }
    if (best < 0.3) return 0;
    sum += best;
  }
  return sum / words.length;
}

function personalOk(p: PersonalFilter, t: Track, s: TrackStat | undefined, ctx: VibeContext): boolean {
  const plays = s?.plays ?? 0;
  const last = s?.lastPlayedAt ?? null;
  switch (p) {
    case 'favorites':
      return ctx.favorites.has(t.id);
    case 'most-played':
      return plays >= 1;
    case 'recent':
      return last !== null && ctx.now - last <= 7 * DAY_MS;
    case 'forgotten':
      return plays >= 3 && last !== null && ctx.now - last > 60 * DAY_MS;
    case 'new':
      return t.dateAdded > 0 && ctx.now - t.dateAdded <= 30 * DAY_MS;
    case 'never-played':
      return plays === 0;
    default:
      return true;
  }
}

function inRange(v: number, r: Range): boolean {
  return v >= r[0] && v <= r[1];
}

/** Soft fit to the energy/valence/bpm ranges; only analysed tracks can be penalized. */
function rangeFit(q: VibeQuery, f: Features | undefined): number {
  if (!q.energy && !q.valence && !q.bpm) return 1;
  if (!f) return 0.85;
  const parts: number[] = [];
  if (q.energy && Number.isFinite(f.energy)) parts.push(rangeCloseness(f.energy, q.energy));
  if (q.valence && Number.isFinite(f.valence)) parts.push(rangeCloseness(f.valence, q.valence));
  if (q.bpm) {
    const b = bpmCloseness(f, q.bpm);
    if (b !== null) parts.push(b);
  }
  if (!parts.length) return 0.85;
  const geo = Math.exp(parts.reduce((s, v) => s + Math.log(Math.max(v, 1e-6)), 0) / parts.length);
  return 0.25 + 0.75 * geo;
}

/** Graded so the heaviest low end ranks first; below the 0.65 "bass-heavy" line it falls off quadratically. */
function bassFit(t: Track, f: Features | undefined): number {
  const bassyFamily = familyCandidates(t).some((id) => isBassyFamily(id));
  if (f && Number.isFinite(f.bass)) {
    const b = Math.max(0, f.bass);
    const fit = b >= 0.65 ? 0.85 + 0.15 * Math.min(1, (b - 0.65) / 0.3) : 0.15 + 0.7 * (b / 0.65) ** 2;
    return bassyFamily ? Math.max(fit, 0.6) : fit;
  }
  if (bassyFamily) return 0.8;
  return keywordMoods(t).has('bass') ? 0.7 : 0.35;
}

function hasConstraints(q: VibeQuery, seed: Track | undefined): boolean {
  return Boolean(
    q.text || q.moods.length || q.energy || q.valence || q.bpm || q.bassHeavy || q.era || q.genres.length ||
      q.personal.length || q.durationMs || seed,
  );
}

type Row = { t: Track; score: number; plays: number; extra: number; key: string };

/**
 * Ranks the library for a parsed vibe. Era/genre/duration/personal filters and text are hard
 * constraints; moods, sound-alike and feature ranges are soft and multiply into the score.
 */
export function rankByVibe(q: VibeQuery, ctx: VibeContext, limit = 100): ScoredTrack[] {
  const seed = q.similarTo ? ctx.lib.byId.get(q.similarTo) : undefined;
  if (limit <= 0 || !hasConstraints(q, seed)) return [];
  const words = q.text ? normalize(q.text).split(' ').filter(Boolean) : [];
  const moods = q.moods.map(moodById);
  const genres = new Set(q.genres);
  const seedTitle = seed ? normalize(seed.title) : '';
  const seedArtist = seed ? artistIdOf(primaryArtist(seed)) : '';
  const mostPlayed = q.personal.includes('most-played');
  const rows: Row[] = [];
  for (const t of ctx.lib.tracks) {
    if (seed && (t.id === seed.id || (normalize(t.title) === seedTitle && artistIdOf(primaryArtist(t)) === seedArtist))) {
      continue;
    }
    if (q.durationMs && t.durationMs > 0 && !inRange(t.durationMs, q.durationMs)) continue;
    if (q.era && t.year !== null && !inRange(t.year, q.era)) continue;
    const fams = genres.size ? familyCandidates(t) : [];
    if (fams.length && !fams.some((id) => genres.has(id))) continue;
    const s = ctx.stats.get(t.id);
    if (!q.personal.every((p) => personalOk(p, t, s, ctx))) continue;
    const text = words.length ? textMatch(words, t) : 1;
    if (text <= 0) continue;
    const f = ctx.features.get(t.id);
    let primary = 1;
    if (moods.length) {
      const fit = moods.map((m) => moodScore(m, t, f));
      primary = 0.7 * (fit.reduce((a, b) => a + b, 0) / fit.length) + 0.3 * Math.min(...fit);
      if (primary < 0.2) continue;
    }
    if (seed) primary *= pairScore(seed, t, ctx);
    let score = primary * rangeFit(q, f);
    if (q.bassHeavy) score *= bassFit(t, f);
    if (genres.size && !fams.length) score *= 0.7;
    if (q.era && t.year === null) score *= 0.7;
    if (words.length) score *= 0.5 + 0.5 * text;
    const plays = s?.plays ?? 0;
    score += 0.02 * Math.min(1, Math.log2(1 + plays) / 6);
    const extra = q.personal.includes('recent')
      ? (s?.lastPlayedAt ?? 0)
      : q.personal.includes('new')
        ? t.dateAdded
        : 0;
    rows.push({ t, score, plays, extra, key: sortKey(t.title) });
  }
  const best = rows.reduce((m, r) => Math.max(m, r.score), 0);
  const floor = Math.max(0.1, 0.3 * best);
  return rows
    .filter((r) => r.score >= floor)
    .sort(
      (a, b) =>
        (mostPlayed ? b.plays - a.plays : 0) ||
        b.score - a.score ||
        b.extra - a.extra ||
        b.plays - a.plays ||
        compareKeys(a.key, b.key) ||
        (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0),
    )
    .slice(0, limit)
    .map((r) => ({ id: r.t.id, score: Math.min(1, r.score) }));
}

function clampUnit(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5;
}

/** Where a track sits on the Mood Map (energy up, valence right). */
export function estimatePoint(track: Track, f: Features | undefined): { energy: number; valence: number } {
  return pointOf(track, f);
}

/** Mood Map XY pad: tracks nearest to the touched point; estimated positions rank slightly lower. */
export function rankByPoint(ctx: VibeContext, energy: number, valence: number, limit = 50): ScoredTrack[] {
  if (limit <= 0) return [];
  const e = clampUnit(energy);
  const v = clampUnit(valence);
  return ctx.lib.tracks
    .map((t) => {
      const f = ctx.features.get(t.id);
      const p = pointOf(t, f);
      const score = (1 - Math.hypot(p.energy - e, p.valence - v) / Math.SQRT2) * (f ? 1 : 0.85);
      return { t, score, key: sortKey(t.title) };
    })
    .sort((a, b) => b.score - a.score || compareKeys(a.key, b.key) || (a.t.id < b.t.id ? -1 : a.t.id > b.t.id ? 1 : 0))
    .slice(0, limit)
    .map((r) => ({ id: r.t.id, score: Math.max(0, r.score) }));
}

/** "Chill · Late night · Bass-heavy", with leftover words quoted: "Chill · “prateek kuhad”". */
export function describeVibe(q: VibeQuery): string {
  return q.chips.map((c) => (c.kind === 'text' ? `\u201c${c.label}\u201d` : c.label)).join(' \u00b7 ');
}

/** Prompts the Vibe tab suggests. Each one must parse completely, with no leftover text (see tests). */
export const VIBE_EXAMPLES = [
  'chill late night lofi',
  'bass heavy punjabi',
  'sad songs from the 90s',
  'upbeat songs for workout',
  "stuff I haven't heard in a while",
  'romantic bollywood',
  'focus music under 4 minutes',
  'happy 2010s',
  'slow sufi',
  'driving at night',
] as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `s` without one occurrence of `part`; a whole-word one ("bass", not the start of "bassline") when there is one. */
function cutOnce(s: string, part: string): string {
  if (!part) return s;
  const whole = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(part)}(?![\\p{L}\\p{N}])`, 'u').exec(s);
  const at = whole ? whole.index + whole[1].length : s.indexOf(part);
  return at < 0 ? s : `${s.slice(0, at)} ${s.slice(at + part.length)}`;
}

function cutChip(raw: string, chip: VibeChip): string {
  const source = chip.source.trim();
  let out = chip.kind === 'text' ? raw : cutOnce(raw, source);
  // Leftover text is gathered from anywhere in the query, so its words go one at a time.
  if (out === raw) out = source.split(/\s+/).filter(Boolean).reduce(cutOnce, raw);
  return out.replace(/\s+/g, ' ').trim();
}

/** The query with a chip's words taken out, so tapping a chip un-says it. */
export function withoutChip(input: string, chip: VibeChip, now: Date = new Date(), lib?: Library): string {
  let out = cutChip(straightQuotes(input), chip);
  // One idea said twice ("bassline bass") makes a single chip, so cut until it's really gone.
  for (let i = 0; i < 4; i++) {
    const again = parseVibe(out, now, lib).chips.find((c) => c.kind === chip.kind && c.label === chip.label);
    const next = again ? cutChip(out, again) : out;
    if (next === out) break;
    out = next;
  }
  return out;
}
