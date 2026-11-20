// Combining marks that act as diacritics. Indic vowel signs and viramas are kept (they carry meaning);
// nuktas are dropped so "ज़िंदगी" and "जिंदगी" match.
const DIACRITICS =
  /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f\u0591-\u05c7\u064b-\u065f\u0670\u093c\u09bc\u0a3c\u0abc\u0b3c\u0c3c\u0cbc]/g;
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
const APOSTROPHES = /['\u2018\u2019\u201b`\u00b4\u02bc]/g;
const DOLLAR_AFTER_LETTER = /(\p{L})\$/gu;
const DOLLAR_BEFORE_LETTER = /\$(?=\p{L})/gu;
const INITIALISM = /(^|[^\p{L}\p{N}])((?:\p{L}\.){2,})/gu;
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu;
const NORMALIZED_ASCII = /^[a-z0-9]+(?: [a-z0-9]+)*$/;

const normCache = new Map<string, string>();
const NORM_CACHE_MAX = 20000;

/** Lowercase, diacritic-free, punctuation-free form used for matching and keys. Idempotent. */
export function normalize(s: string): string {
  if (!s) return '';
  if (NORMALIZED_ASCII.test(s)) return s;
  const cached = normCache.get(s);
  if (cached !== undefined) return cached;
  const out = s
    .toLowerCase()
    .normalize('NFKD')
    .replace(DIACRITICS, '')
    .replace(INVISIBLE, '')
    .replace(APOSTROPHES, '')
    // Stylised "$" inside names: "KR$NA" -> "krsna", "A$AP" -> "asap" (amounts like "$100" are left alone).
    .replace(DOLLAR_AFTER_LETTER, '$1s')
    .replace(DOLLAR_BEFORE_LETTER, 's')
    // "A.R. Rahman" -> "AR Rahman" so it matches "ar rahman".
    .replace(INITIALISM, (_m, pre: string, seq: string) => `${pre}${seq.replace(/\./g, '')} `)
    .replace(/&/g, ' and ')
    .replace(NON_WORD, ' ')
    .trim();
  if (normCache.size >= NORM_CACHE_MAX) normCache.clear();
  normCache.set(s, out);
  return out;
}

export function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

const ARTICLE = /^(?:the|a|an) (?=\S)/;

/** Key for alphabetical sorting: normalized, leading article and punctuation/emoji dropped. */
export function sortKey(s: string): string {
  const n = normalize(s);
  return n.replace(ARTICLE, '') || n;
}

function keyRank(k: string): number {
  if (!k) return 3;
  const c = k.charCodeAt(0);
  if (c >= 97 && c <= 122) return 0;
  if (c >= 48 && c <= 57) return 2;
  return 1;
}

/** Compares sort keys: Latin A-Z first, then other scripts, then digits, then empty (the '#' section is last). */
export function compareKeys(a: string, b: string): number {
  const ra = keyRank(a);
  const rb = keyRank(b);
  if (ra !== rb) return ra - rb;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareText(a: string, b: string): number {
  return compareKeys(sortKey(a), sortKey(b));
}

/** 'A'..'Z' from the sort key, otherwise '#'. */
export function sectionLetter(s: string): string {
  const k = sortKey(s);
  const c = k.charCodeAt(0);
  return c >= 97 && c <= 122 ? k[0].toUpperCase() : '#';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Acts whose names contain a separator; kept whole when splitting credits.
const PROTECTED_ARTISTS = [
  'Tyler, The Creator',
  'Earth, Wind & Fire',
  'Crosby, Stills, Nash & Young',
  'Emerson, Lake & Palmer',
  'Blood, Sweat & Tears',
  'Peter, Paul & Mary',
  'Simon & Garfunkel',
  'Hall & Oates',
  'Mumford & Sons',
  'Florence & The Machine',
  'Of Monsters & Men',
  'Chase & Status',
  'Above & Beyond',
  'Shankar, Ehsaan & Loy',
  'Shankar Ehsaan & Loy',
  'Vishal & Shekhar',
  'Salim & Sulaiman',
  'Sachin & Jigar',
  'Jatin & Lalit',
  'Sajid & Wajid',
  'Nadeem & Shravan',
  'Anand & Milind',
  'Laxmikant & Pyarelal',
  'Kalyanji & Anandji',
  'Shankar & Jaikishan',
  'Ajay & Atul',
  'Harris & Ford',
];
const PROTECTED_RE = new RegExp(PROTECTED_ARTISTS.map(escapeRegExp).join('|'), 'gi');
const FEAT_IN_BRACKETS = /\s*[([]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]*)[)\]]/gi;
const ARTIST_SEP =
  /\s*[,;]\s*|\s+(?:&|\/|x|\u00d7|vs\.?|featuring|feat|ft)\s+|\s+(?:feat|ft)\.\s*/i;

function splitBareSlash(part: string): string[] {
  if (!part.includes('/')) return [part];
  const bits = part.split('/').map((b) => b.trim());
  if (bits.some((b) => b.length < 3)) return [part];
  if (bits.every((b) => b.length >= 4) || bits.some((b) => b.includes(' '))) return bits;
  return [part];
}

/** Splits a credit line into individual artists, primary first, deduped case-insensitively. */
export function splitArtists(s: string): string[] {
  if (!s || !s.trim()) return [];
  const kept: string[] = [];
  let line = s.replace(PROTECTED_RE, (m) => {
    kept.push(m);
    return `\u0001${kept.length - 1}\u0001`;
  });
  line = line.replace(FEAT_IN_BRACKETS, ' feat. $1');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of line.split(ARTIST_SEP)) {
    for (const piece of splitBareSlash(raw)) {
      let name = piece
        .replace(/\u0001(\d+)\u0001/g, (_m, i: string) => kept[Number(i)] ?? '')
        .trim()
        .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '')
        .trim();
      if (name.endsWith(')') && !name.includes('(')) name = name.slice(0, -1).trim();
      if (name.startsWith('(') && !name.includes(')')) name = name.slice(1).trim();
      const key = normalize(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

const EXTENSION =
  /\.(?:mp3|m4a|m4b|mp4|aac|flac|wav|wave|ogg|oga|opus|wma|amr|awb|aif|aiff|alac|ape|wv|mka|webm|3gp|mid|midi)$/i;

// Download sites that stamp their name on Indian MP3s.
const SITE =
  '(?:pagal\\s?world(?:\\.\\w+)?|pagal\\s?(?:free|new|song)s?(?:\\.\\w+)?|dj\\s?maza(?:\\.\\w+)?|mr[-\\s]?jatt(?:\\.\\w+)?|' +
  '(?:www\\.)?songs\\.?pk(?:\\.\\w+)?|web\\s?music(?:\\.\\w+)?|raag\\.?fm|download\\s?ming(?:\\.\\w+)?|my\\s?mp3\\s?song(?:\\.\\w+)?|' +
  'mp3\\s?mad(?:\\.\\w+)?|dj\\s?punjab(?:\\.\\w+)?|dj\\s?johal(?:\\.\\w+)?|wap\\s?king(?:\\.\\w+)?|fresh\\s?maza(?:\\.\\w+)?|' +
  'best\\s?wap(?:\\.\\w+)?|jatt\\s?jugad(?:\\.\\w+)?|mirchi\\s?fun(?:\\.\\w+)?|pendu\\s?jatt(?:\\.\\w+)?|risky\\s?jatt(?:\\.\\w+)?|' +
  'mass\\s?tamilan(?:\\.\\w+)?|star\\s?musiq(?:\\.\\w+)?|tamil\\s?wire(?:\\.\\w+)?|isaimini(?:\\.\\w+)?|naa\\s?songs(?:\\.\\w+)?|' +
  'mp3\\s?tau(?:\\.\\w+)?|songs\\s?mp3(?:\\.\\w+)?|mp3\\s?skull(?:\\.\\w+)?|songs\\s?lover(?:\\.\\w+)?)';
const TLD =
  '(?:com|in|net|org|pk|info|mobi|fm|me|co|se|io|cc|biz|ws|to|site|live|xyz|club|top|name|us|uk|tk|ml|pw|link|online|app|tv)';
const DOMAIN = `(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.${TLD}(?:\\/\\S*)?`;
const JUNK_WORDS =
  '(?:official(?:\\s+(?:music|lyrics?|lyrical|full|hd|4k|audio|video|song|visuali[sz]er))+|' +
  '(?:full\\s+|hd\\s+|hq\\s+)?(?:video|audio|lyrics?|lyrical)(?:\\s+(?:song|video|version))?|' +
  'full\\s+(?:song|track|audio|video(?:\\s+song)?)|hd|hq|4k|1080p|720p|visuali[sz]er|mp3|download|free\\s+download|' +
  '(?:new|latest|hit)\\s+songs?|(?:hindi|punjabi|bengali|bangla|tamil|telugu)\\s+(?:songs?|gaane)|' +
  '(?:video|audio|mp3)\\s+songs?|\\d{2,3}\\s*kbps)';

const JUNK_BRACKET = new RegExp(`^(?:${JUNK_WORDS}|${SITE}|${DOMAIN}|[\\s\\-_.]*)$`, 'i');
const BRACKET_GROUP = /[([{]([^()[\]{}]*)[)\]}]/g;
const INLINE_SITE = new RegExp(`(^|[^\\p{L}\\p{N}])${SITE}(?![\\p{L}\\p{N}])`, 'giu');
const INLINE_DOMAIN = new RegExp(
  `(^|[^\\p{L}\\p{N}])(?:https?:\\/\\/\\S+|www\\.\\S+|[a-z0-9-]+\\.(?:com|net|org|pk|info|mobi|fm|in|cc|biz|ws|se|to)(?:\\/\\S*)?)(?![\\p{L}\\p{N}])`,
  'giu',
);
const INLINE_JUNK = new RegExp(
  `(^|[^\\p{L}\\p{N}])(?:\\d{2,3}\\s*kbps|(?:hindi|punjabi|bengali|bangla)\\s+songs?|(?:full|video|audio|mp3)\\s+songs?|` +
    `official\\s+(?:music\\s+)?(?:video|audio)|lyric(?:al)?\\s+video|full\\s+video)(?![\\p{L}\\p{N}])`,
  'giu',
);
const LEADING_TRACK_NO = /^(?:\d{1,3}(?:\s*[-\u2013.)]\s*|\s{2,})|0\d{1,2}\s+)(?=\p{L})/u;
const EDGE_SEPARATORS = /^[\s\-\u2013\u2014|:_.,~/]+|[\s\-\u2013\u2014|:_,~/]+$/g;
const REPEATED_SEPARATORS = /\s*([-\u2013\u2014|])\s*(?:[-\u2013\u2014|]\s*)+/g;

function stripJunk(s: string): string {
  let out = s.replace(/_+/g, ' ').replace(/%20/g, ' ');
  for (let i = 0; i < 3; i++) {
    const next = out.replace(BRACKET_GROUP, (m, inner: string) => (JUNK_BRACKET.test(inner.trim()) ? ' ' : m));
    if (next === out) break;
    out = next;
  }
  out = out.replace(INLINE_SITE, '$1').replace(INLINE_DOMAIN, '$1').replace(INLINE_JUNK, '$1');
  out = out.replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ');
  out = out.replace(REPEATED_SEPARATORS, ' $1 ');
  out = out.replace(/\s+/g, ' ').replace(EDGE_SEPARATORS, '');
  return out.trim();
}

export function stripExtension(fileName: string): string {
  let out = fileName || '';
  for (let i = 0; i < 2; i++) out = out.replace(EXTENSION, '');
  return out;
}

/** Removes file extensions, track-number prefixes and download-site junk; keeps "(Remix)", "(From ...)" etc. */
export function cleanTitle(s: string): string {
  if (!s) return '';
  let out = stripJunk(stripExtension(s.trim()));
  out = out.replace(LEADING_TRACK_NO, '');
  return out.replace(EDGE_SEPARATORS, '').trim();
}

const UNKNOWN_VALUES = new Set([
  'unknown',
  'unknown artist',
  'unknown album',
  'unknown genre',
  'unknown title',
  'unknown track',
  'null',
  'undefined',
  'none',
  'n a',
  'no artist',
  'no album',
  'no genre',
]);
// MediaStore falls back to the folder name when a file has no album tag.
const FOLDER_ALBUMS = new Set(['download', 'downloads', 'bluetooth', 'whatsapp audio', 'telegram audio', 'sdcard', 'emulated', '0']);

function cleanName(s: string): string {
  if (!s) return '';
  const out = stripJunk(s.trim());
  const key = normalize(out);
  if (!key || UNKNOWN_VALUES.has(key)) return '';
  return out;
}

/** Junk-free artist credit; '' for unknown/empty so callers can substitute. */
export function cleanArtist(s: string): string {
  return cleanName(s);
}

/** Junk-free album title; '' for unknown/empty (and MediaStore folder fallbacks like "Download"). */
export function cleanAlbum(s: string): string {
  const out = cleanName(s);
  return FOLDER_ALBUMS.has(normalize(out)) ? '' : out;
}

// ID3v1 genre numbers, still common in old MP3s as "(17)" or "17".
const ID3_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal',
  'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial',
  'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk',
  'Fusion', 'Trance', 'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
  'Alternative Rock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative', 'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic',
  'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk', 'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta',
  'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle', 'Native American', 'Cabaret', 'New Wave', 'Psychedelic', 'Rave', 'Showtunes',
  'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk', 'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock',
];

/** Cleans a genre tag: junk removed, ID3v1 numbers decoded, "Other"/unknown -> ''. */
export function cleanGenre(s: string): string {
  if (!s) return '';
  let out = s.trim();
  const id3 = /^\((\d{1,3})\)\s*(.*)$|^(\d{1,3})$/.exec(out);
  if (id3) {
    const rest = (id3[2] ?? '').trim();
    out = rest || ID3_GENRES[Number(id3[1] ?? id3[3])] || '';
  }
  out = cleanName(out);
  return normalize(out) === 'other' ? '' : out;
}

const VIRAMA = /[\u094d\u09cd\u0a4d\u0acd\u0b4d\u0bcd\u0c4d\u0ccd\u0d4d\u0dca]/;
const EXTEND = /[\p{M}\u200c\u200d\ufe0e\ufe0f]/u;

function firstGrapheme(word: string): string {
  const cps = Array.from(word);
  if (!cps.length) return '';
  let g = cps[0];
  for (let i = 1; i < cps.length; i++) {
    const c = cps[i];
    // Stop before a virama so a conjunct's first consonant doesn't render with a dangling halant.
    if (VIRAMA.test(c) || !EXTEND.test(c)) break;
    g += c;
  }
  const up = g.toUpperCase();
  return Array.from(up).length === Array.from(g).length ? up : g;
}

/** Up to two initials ("Arijit Singh" -> "AS", "অনুপম রায়" -> "অরা"), first grapheme of each word. */
export function initials(s: string): string {
  const words = (s || '')
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean);
  if (words.length > 1 && /^(?:the|a|an)$/i.test(words[0])) words.shift();
  if (!words.length) return '';
  const first = firstGrapheme(words[0]);
  return words.length === 1 ? first : first + firstGrapheme(words[1]);
}

function sameFrom(a: string, ia: number, b: string, ib: number): boolean {
  if (a.length - ia !== b.length - ib) return false;
  for (let i = ia, j = ib; i < a.length; i++, j++) if (a.charCodeAt(i) !== b.charCodeAt(j)) return false;
  return true;
}

/** True when the optimal-string-alignment (Damerau-Levenshtein) distance is at most 1. */
export function within1Edit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (la === lb) {
    if (sameFrom(a, i + 1, b, i + 1)) return true;
    return i + 1 < la && a[i] === b[i + 1] && a[i + 1] === b[i] && sameFrom(a, i + 2, b, i + 2);
  }
  return la > lb ? sameFrom(a, i + 1, b, i) : sameFrom(a, i, b, i + 1);
}

/** Density (0..1] of `q` as an in-order subsequence of `t` starting at a word start, 0 if none or too sparse. */
function subsequence(q: string, t: string): number {
  const maxSpan = q.length * 2.5 + 2;
  for (let start = 0; start < t.length; start++) {
    if (t[start] !== q[0] || (start > 0 && t[start - 1] !== ' ')) continue;
    let qi = 1;
    let ti = start + 1;
    while (qi < q.length && ti < t.length && ti - start < maxSpan) {
      if (t[ti] === q[qi]) qi++;
      ti++;
    }
    if (qi === q.length) return q.length / (ti - start);
  }
  return 0;
}

/**
 * Score of one (normalized) query word against one (normalized) target word, 0..1.
 * exact 1 > prefix 0.9+ > substring 0.6+ > subsequence 0.4+ > one typo 0.32-0.34.
 */
export function tokenScore(q: string, t: string): number {
  if (q === t) return 1;
  if (!q || !t) return 0;
  if (t.startsWith(q)) return 0.9 + 0.09 * (q.length / t.length);
  if (q.length >= 3) {
    if (t.includes(q)) return 0.6 + 0.08 * (q.length / t.length);
    if (q[0] === t[0]) {
      const d = subsequence(q, t);
      if (d > 0) return 0.4 + 0.12 * d;
    }
  }
  if (q.length >= 4 && t.length >= 4) {
    if (within1Edit(q, t)) return 0.34;
    if (t.length > q.length && within1Edit(q, t.slice(0, q.length))) return 0.32;
  }
  return 0;
}

function allWordsPrefix(qt: string[], tt: string[]): boolean {
  const used = new Array<boolean>(tt.length).fill(false);
  for (const q of qt) {
    let found = false;
    for (let j = 0; j < tt.length; j++) {
      if (!used[j] && tt[j].startsWith(q)) {
        used[j] = true;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

function typoMatch(qt: string[], tt: string[]): boolean {
  for (const q of qt) {
    let ok = false;
    for (const t of tt) {
      if (t.startsWith(q)) {
        ok = true;
        break;
      }
      if (q.length >= 4 && t.length >= 4 && (within1Edit(q, t) || (t.length > q.length && within1Edit(q, t.slice(0, q.length))))) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

/** fuzzyScore for inputs that are already normalized. */
export function scoreNormalized(q: string, t: string): number {
  if (!q || !t) return 0;
  if (q === t) return 1;
  const ratio = Math.min(1, q.length / t.length);
  if (t.startsWith(q)) return 0.9 + 0.09 * ratio;
  if (t.includes(` ${q}`)) return 0.8 + 0.08 * ratio;
  const qt = q.split(' ');
  const tt = t.split(' ');
  if (qt.length > 1 && allWordsPrefix(qt, tt)) return 0.76 + 0.03 * ratio;
  const qc = qt.length > 1 ? qt.join('') : q;
  if (qc.length >= 2 && tt.length >= 2) {
    let ini = '';
    for (const w of tt) ini += w[0];
    if (ini === qc) return 0.7;
    if (qc.length >= 3 && ini.startsWith(qc)) return 0.66;
  }
  if (t.includes(q)) return 0.6 + 0.08 * ratio;
  if (qc.length >= 3) {
    if (tt.length > 1 && tt.join('').includes(qc)) return 0.55;
    const d = subsequence(qc, t);
    if (d > 0) return 0.4 + 0.12 * d;
  }
  return typoMatch(qt, tt) ? 0.32 : 0;
}

/**
 * How well `query` matches `target`, 0..1: exact > prefix > word-prefix > initials ("ddlj") > substring >
 * subsequence > one typo on words of 4+ letters. 0 when there's no match. Inputs may be pre-normalized.
 */
export function fuzzyScore(query: string, target: string): number {
  return scoreNormalized(normalize(query), normalize(target));
}
