import { hashString, mulberry32, pickWeighted } from './random';
import type { PlayEvent, RawTrack, TrackFeatures } from './types';

/** Fixed "now" for the demo data: Friday 14 Nov 2025, 21:00 IST. */
export const SAMPLE_NOW = Date.UTC(2025, 10, 14, 15, 30, 0);

const DAY = 86_400_000;
const MINUTE = 60_000;

type Hint = '' | 'sad' | 'love' | 'party' | 'calm' | 'hype';
/** [title, artist, seconds, hint, year override, file name override] */
type Row = [string, string, number, Hint?, number?, string?];
type Profile = { e: number; v: number; d: number; a: number; b: number; bpm: number; br: number };
type ProfileId = keyof typeof PROFILES;

type AlbumDef = {
  album: string;
  albumArtist: string;
  year: number;
  genre: string;
  folder: string;
  profile: ProfileId;
  format?: 'mp3' | 'flac' | 'm4a';
  kbps: number;
  addedDaysAgo: number;
  /** Encode disc numbers MediaStore-style (disc * 1000 + track); `discSplit` tracks per disc. */
  discSplit?: number;
  noAlbumId?: boolean;
  /** Raw downloads: no track numbers, underscores in file names. */
  untagged?: boolean;
  /** Not analyzed yet. */
  noFeatures?: boolean;
  /** How much the listener likes it, and the extra pull late in the evening. */
  taste: number;
  nightTaste?: number;
  /** Only listened to in this window of days before SAMPLE_NOW. */
  playDays?: [number, number];
  tracks: Row[];
};

const PROFILES = {
  bollywood: { e: 0.55, v: 0.5, d: 0.55, a: 0.35, b: 0.45, bpm: 100, br: 0.5 },
  oldies: { e: 0.5, v: 0.62, d: 0.58, a: 0.45, b: 0.35, bpm: 108, br: 0.45 },
  punjabi: { e: 0.8, v: 0.66, d: 0.78, a: 0.1, b: 0.8, bpm: 98, br: 0.62 },
  bengali: { e: 0.42, v: 0.45, d: 0.4, a: 0.6, b: 0.3, bpm: 90, br: 0.45 },
  bengalirock: { e: 0.68, v: 0.4, d: 0.4, a: 0.2, b: 0.45, bpm: 122, br: 0.6 },
  indie: { e: 0.38, v: 0.45, d: 0.52, a: 0.72, b: 0.28, bpm: 96, br: 0.45 },
  lofi: { e: 0.24, v: 0.42, d: 0.62, a: 0.45, b: 0.55, bpm: 78, br: 0.28 },
  hiphop: { e: 0.78, v: 0.45, d: 0.76, a: 0.08, b: 0.86, bpm: 92, br: 0.55 },
  trap: { e: 0.72, v: 0.35, d: 0.7, a: 0.05, b: 0.92, bpm: 76, br: 0.5 },
  rnb: { e: 0.66, v: 0.42, d: 0.66, a: 0.1, b: 0.62, bpm: 112, br: 0.55 },
  pop: { e: 0.78, v: 0.78, d: 0.82, a: 0.05, b: 0.62, bpm: 116, br: 0.66 },
  edm: { e: 0.88, v: 0.55, d: 0.74, a: 0.03, b: 0.86, bpm: 126, br: 0.7 },
  sufi: { e: 0.6, v: 0.5, d: 0.45, a: 0.5, b: 0.4, bpm: 102, br: 0.5 },
} satisfies Record<string, Profile>;

const HINTS: Record<Hint, Partial<Profile>> = {
  '': {},
  sad: { e: -0.18, v: -0.25, d: -0.12, a: 0.05, bpm: -14 },
  love: { e: -0.08, v: 0.05, a: 0.08, bpm: -6 },
  party: { e: 0.12, v: 0.18, d: 0.14, b: 0.05, bpm: 8 },
  calm: { e: -0.2, a: 0.18, b: -0.08, bpm: -10 },
  hype: { e: 0.12, v: -0.03, d: 0.05, b: 0.08 },
};

const ALBUMS: AlbumDef[] = [
  {
    album: 'Aashiqui 2', albumArtist: '', year: 2013, genre: 'Bollywood Music', folder: 'Music/Bollywood/',
    profile: 'bollywood', kbps: 320, addedDaysAgo: 690, taste: 2.5,
    tracks: [
      ['Tum Hi Ho', 'Arijit Singh', 262, 'sad'],
      ['Sunn Raha Hai', 'Ankit Tiwari', 391, 'sad'],
      ['Chahun Main Ya Naa', 'Arijit Singh & Palak Muchhal', 304, 'love'],
      ['Milne Hai Mujhse Aayi', 'Arijit Singh', 295, 'sad'],
      ['Bhula Dena', 'Mustafa Zahid', 248, 'sad'],
    ],
  },
  {
    album: 'Brahmastra', albumArtist: 'Pritam', year: 2022, genre: 'Bollywood', folder: 'Download/',
    profile: 'bollywood', kbps: 320, addedDaysAgo: 380, taste: 2,
    tracks: [
      ['Kesariya (PagalWorld.com)', 'Arijit Singh', 268, 'love'],
      ['Deva Deva', 'Arijit Singh, Jonita Gandhi', 279, 'calm'],
      ['Rasiya', 'Shreya Ghoshal & Tushar Joshi', 214, 'love'],
      ['Dance Ka Bhoot', 'Arijit Singh', 218, 'party'],
    ],
  },
  {
    album: 'Rockstar', albumArtist: 'A.R. Rahman', year: 2011, genre: 'Hindi Film', folder: 'Music/Bollywood/Rockstar/',
    profile: 'bollywood', format: 'flac', kbps: 0, addedDaysAgo: 600, taste: 1.5,
    tracks: [
      ['Kun Faya Kun', 'A.R. Rahman, Javed Ali, Mohit Chauhan', 473, 'calm'],
      ['Nadaan Parindey', 'A.R. Rahman & Mohit Chauhan', 385, 'hype'],
      ['Tum Ho', 'Mohit Chauhan', 318, 'love'],
      ['Sadda Haq', 'Mohit Chauhan', 365, 'hype'],
    ],
  },
  {
    album: 'Yeh Jawaani Hai Deewani', albumArtist: 'Pritam', year: 2013, genre: 'Bollywood Music',
    folder: 'Music/Bollywood/', profile: 'bollywood', kbps: 320, addedDaysAgo: 540, taste: 1.5,
    tracks: [
      ['Badtameez Dil', 'Benny Dayal & Shefali Alvares', 252, 'party'],
      ['Kabira', 'Tochi Raina & Rekha Bhardwaj', 223, 'calm'],
      ['Ilahi', 'Arijit Singh', 228],
      ['Balam Pichkari', 'Vishal Dadlani & Shalmali Kholgade', 289, 'party'],
    ],
  },
  {
    album: 'Dilwale Dulhania Le Jayenge', albumArtist: 'Jatin-Lalit', year: 1995, genre: 'Filmi',
    folder: 'Music/Old Hindi/', profile: 'oldies', kbps: 128, addedDaysAgo: 720, discSplit: 99, taste: 5,
    playDays: [65, 89],
    tracks: [
      ['Tujhe Dekha To', 'Lata Mangeshkar & Kumar Sanu', 303, 'love'],
      ['Mehndi Laga Ke Rakhna 128 Kbps', 'Lata Mangeshkar & Udit Narayan', 306, 'party'],
      ['Ho Gaya Hai Tujhko', 'Lata Mangeshkar & Udit Narayan', 316, 'love'],
      ['Zara Sa Jhoom Loon Main', 'Asha Bhosle & Abhijeet', 304, 'party'],
    ],
  },
  {
    album: 'Dil Se..', albumArtist: 'A.R. Rahman', year: 1998, genre: 'Bollywood', folder: 'Music/Old Hindi/',
    profile: 'oldies', kbps: 128, addedDaysAgo: 710, taste: 5, playDays: [65, 89],
    tracks: [
      ['Chaiyya Chaiyya - www.Songs.PK', 'Sukhwinder Singh & Sapna Awasthi', 414, 'party'],
      ['Dil Se Re', 'A.R. Rahman', 405, 'hype'],
      ['Jiya Jale', 'Lata Mangeshkar', 304, 'love'],
      ['Satrangi Re', 'Sonu Nigam & Kavita Krishnamurthy', 445, 'sad'],
    ],
  },
  {
    album: 'Animal', albumArtist: 'Various Artists', year: 2023, genre: '', folder: 'Download/',
    profile: 'bollywood', kbps: 320, addedDaysAgo: 300, taste: 2,
    tracks: [
      ['Arjan Vailly', 'Bhupinder Babbal', 182, 'hype', 0],
      ['Satranga', 'Arijit Singh', 271, 'sad'],
      ['Hua Main', 'Raghav Chaitanya & Pritam', 259, 'love'],
      ['Pehle Bhi Main', 'Vishal Mishra', 250, 'sad'],
    ],
  },
  {
    album: 'Punjabi Hitlist', albumArtist: '', year: 2023, genre: 'Punjabi', folder: 'Music/Punjabi/',
    profile: 'punjabi', kbps: 320, addedDaysAgo: 450, taste: 3, nightTaste: 2.2,
    tracks: [
      ['Brown Munde', 'AP Dhillon, Gurinder Gill & Shinda Kahlon', 267, 'hype', 2020],
      ['Excuses', 'AP Dhillon & Gurinder Gill', 176, 'love', 2020],
      ['Lover', 'Diljit Dosanjh', 191, 'love', 2021],
      ['Softly', 'Karan Aujla', 162, 'party', 2023],
      ['Winning Speech', 'Karan Aujla', 176, 'hype', 2023],
      ['295', 'Sidhu Moose Wala', 270, 'hype', 2022],
    ],
  },
  {
    album: 'G.O.A.T.', albumArtist: 'Diljit Dosanjh', year: 2020, genre: 'Bhangra', folder: 'Music/Punjabi/',
    profile: 'punjabi', format: 'm4a', kbps: 256, addedDaysAgo: 520, taste: 2, nightTaste: 2,
    tracks: [
      ['G.O.A.T.', 'Diljit Dosanjh', 228, 'hype'],
      ['Born To Shine', 'Diljit Dosanjh', 199, 'party'],
      ['Clash', 'Diljit Dosanjh', 202, 'hype'],
      ['Peaches', 'Diljit Dosanjh', 170, 'party'],
    ],
  },
  {
    album: 'Bangla Hits', albumArtist: 'Various Artists', year: 2014, genre: 'Bangla', folder: 'Music/Bengali/',
    profile: 'bengali', kbps: 320, addedDaysAgo: 640, taste: 1.5,
    tracks: [
      ['Amake Amar Moto Thakte Dao', 'Anupam Roy', 270, 'calm', 2010],
      ['Bariye Dao Tomar Haat', 'Anupam Roy', 258, 'love', 2014],
      ['Mon Majhi Re', 'Arijit Singh', 285, 'love', 2013],
      ['Tomake Chai', 'Arijit Singh', 232, 'love', 2016],
    ],
  },
  {
    album: 'Fossils 2', albumArtist: 'Fossils', year: 2004, genre: 'Bangla Rock', folder: 'Music/Bengali/',
    profile: 'bengalirock', kbps: 320, addedDaysAgo: 610, taste: 1,
    tracks: [
      ['Aro Ekbar', 'Fossils', 335, 'sad'],
      ['Hasnuhana', 'Fossils', 300, 'hype'],
      ['Ekla Ghor', 'Rupam Islam', 290, 'sad'],
    ],
  },
  {
    album: 'Aalas Ka Pedh', albumArtist: 'The Local Train', year: 2015, genre: 'Indian Indie', folder: 'Music/Indie/',
    profile: 'indie', kbps: 320, addedDaysAgo: 560, taste: 1.5,
    tracks: [
      ['Choo Lo', 'The Local Train', 268, 'love'],
      ['Aaoge Tum Kabhi', 'The Local Train', 271, 'sad'],
      ['Dil Mere', 'The Local Train', 300, 'calm'],
    ],
  },
  {
    album: 'Indie Essentials', albumArtist: 'Various Artists', year: 2020, genre: 'Indie Pop', folder: 'Music/Indie/',
    profile: 'indie', kbps: 320, addedDaysAgo: 260, taste: 2, nightTaste: 1.3,
    tracks: [
      ['cold/mess', 'Prateek Kuhad', 303, 'sad', 2018],
      ['Kasoor', 'Prateek Kuhad', 172, 'love', 2020],
      ['Ocean Tide', 'When Chai Met Toast', 230, 'calm', 2016],
      ['When We Feel Young', 'When Chai Met Toast', 225, 'party', 2019],
      ['Baarishein', 'Anuv Jain', 205, 'love', 2018],
      ['Alag Aasmaan', 'Anuv Jain', 245, 'calm', 2020],
    ],
  },
  {
    album: 'Bollywood Lofi', albumArtist: 'Lofi Chai', year: 2022, genre: 'Lo-Fi', folder: 'Music/Lofi/',
    profile: 'lofi', kbps: 320, addedDaysAgo: 330, noAlbumId: true, taste: 1.5, nightTaste: 2.5,
    tracks: [
      ['Kesariya (Lofi Flip)', 'Arijit Singh x Lofi Chai', 190, 'calm'],
      ['Tum Hi Ho (Lofi Flip)', 'Arijit Singh x Lofi Chai', 205, 'sad'],
      ['Raataan Lambiyan (Lofi Flip)', 'Jubin Nautiyal x Lofi Chai', 198, 'love'],
      ['Agar Tum Saath Ho (Lofi Flip)', 'Arijit Singh x Lofi Chai', 230, 'sad'],
      ['Phir Le Aya Dil (Lofi Flip)', 'Arijit Singh x Lofi Chai', 212, 'calm'],
    ],
  },
  {
    album: 'Desi Hip-Hop', albumArtist: '', year: 2020, genre: 'Hip-Hop/Rap', folder: 'Music/HipHop/',
    profile: 'hiphop', kbps: 320, addedDaysAgo: 420, taste: 2, nightTaste: 1.5,
    tracks: [
      ['Mere Gully Mein', 'Divine feat. Naezy', 228, 'hype', 2015],
      ['Jungli Sher', 'Divine', 186, 'hype', 2019],
      ['Nanchaku', 'Seedhe Maut feat. MC STAN', 203, 'hype', 2022],
      ['Saza-E-Maut', 'Raftaar x KR$NA', 236, 'hype', 2020],
      ['Machayenge', 'Emiway Bantai', 218, 'party', 2019],
    ],
  },
  {
    album: 'Astroworld', albumArtist: 'Travis Scott', year: 2018, genre: 'Hip-Hop/Rap', folder: 'Music/English/',
    profile: 'trap', kbps: 320, addedDaysAgo: 500, taste: 1.5, nightTaste: 1.3,
    tracks: [
      ['SICKO MODE', 'Travis Scott feat. Drake', 312, 'hype'],
      ['STARGAZING', 'Travis Scott', 270, 'hype'],
      ['BUTTERFLY EFFECT', 'Travis Scott', 190],
    ],
  },
  {
    album: 'After Hours', albumArtist: 'The Weeknd', year: 2020, genre: 'R&B/Soul', folder: 'Music/English/',
    profile: 'rnb', format: 'flac', kbps: 980, addedDaysAgo: 470, taste: 2, nightTaste: 1.5,
    tracks: [
      ['Blinding Lights', 'The Weeknd', 200, 'party'],
      ['Save Your Tears', 'The Weeknd', 215],
      ['In Your Eyes', 'The Weeknd', 237],
      ['After Hours', 'The Weeknd', 361, 'sad'],
    ],
  },
  {
    album: 'Future Nostalgia', albumArtist: 'Dua Lipa', year: 2020, genre: 'Pop', folder: 'Music/English/',
    profile: 'pop', format: 'm4a', kbps: 256, addedDaysAgo: 430, taste: 1.2,
    tracks: [
      ['Levitating', 'Dua Lipa', 203, 'party'],
      ["Don't Start Now", 'Dua Lipa', 183, 'party'],
      ['Physical', 'Dua Lipa', 193, 'hype'],
    ],
  },
  {
    album: 'EDM Bangers', albumArtist: '', year: 2015, genre: 'Electronic', folder: 'Music/EDM/',
    profile: 'edm', kbps: 320, addedDaysAgo: 360, taste: 1.3,
    tracks: [
      ['Animals', 'Martin Garrix', 304, 'hype', 2013],
      ['Levels', 'Avicii', 199, 'party', 2011],
      ['Lean On', 'Major Lazer & DJ Snake feat. M\u00d8', 176, 'party', 2015],
      ['Faded', 'Alan Walker', 212, 'sad', 2015],
      ['Udd Gaye', 'Ritviz', 189, 'party', 2017],
    ],
  },
  {
    album: 'Coke Studio Sessions', albumArtist: 'Coke Studio', year: 2022, genre: 'Sufi', folder: 'Music/Sufi/',
    profile: 'sufi', kbps: 320, addedDaysAgo: 230, taste: 1.5,
    tracks: [
      ['Pasoori', 'Ali Sethi x Shae Gill', 224, 'party', 2022],
      ['Tu Jhoom', 'Naseebo Lal & Abida Parveen', 295, 'calm', 2022],
      ['Kana Yaari', 'Kaifi Khalil, Eva B & Abdul Wahab Bugti', 276, 'calm', 2022],
      ['Afreen Afreen', 'Rahat Fateh Ali Khan & Momina Mustehsan', 330, 'love', 2016],
      ['Tajdar-e-Haram', 'Atif Aslam', 612, 'calm', 2015],
    ],
  },
  {
    album: 'Bollywood Hits 2024', albumArtist: 'Various Artists', year: 2024, genre: 'Bollywood',
    folder: 'Music/Bollywood/', profile: 'bollywood', kbps: 320, addedDaysAgo: 12, discSplit: 2, noFeatures: true,
    taste: 3,
    tracks: [
      ['Tauba Tauba', 'Karan Aujla', 211, 'party'],
      ['Aaj Ki Raat', 'Madhubanti Bagchi & Divya Kumar', 228, 'party'],
      ['Sajni', 'Arijit Singh', 170, 'love'],
      ['Saiyaara', 'Faheem Abdullah & Arslan Nizami', 366, 'love', 2025],
    ],
  },
  {
    // Untagged downloads: MediaStore reports the folder name as the album.
    album: 'Download', albumArtist: '', year: 0, genre: '', folder: 'Download/', profile: 'bollywood', kbps: 320,
    addedDaysAgo: 20, untagged: true, noFeatures: true, taste: 1,
    tracks: [
      ['Tu Cheez Badi Hai Mast Mast (Mr-Jatt)', 'Udit Narayan, Kavita Krishnamurthy', 368, 'party', 1994],
      ['Ek Ladki Ko Dekha - DJMaza', 'Kumar Sanu', 263, 'love', 1994],
      ['Husn - Anuv Jain (Mp3Mad)', '<unknown>', 219, 'sad', 2023],
      ['', 'Anuv Jain', 194, 'love', 0, 'Gul_-_Anuv_Jain.mp3'],
    ],
  },
];

/** Listened to a lot; weighted up when generating plays. */
const FAVOURITES = new Set([
  'Tum Hi Ho',
  'Brown Munde',
  'Excuses',
  'Softly',
  'Blinding Lights',
  'Baarishein',
  'Kasoor',
  'Kesariya (PagalWorld.com)',
  'Pasoori',
  'Tum Hi Ho (Lofi Flip)',
]);

const clampUnit = (x: number): number => Math.min(0.98, Math.max(0.02, x));
const round = (x: number, digits = 3): number => Math.round(x * 10 ** digits) / 10 ** digits;

const FORMATS = {
  mp3: { mime: 'audio/mpeg', ext: 'mp3' },
  flac: { mime: 'audio/flac', ext: 'flac' },
  m4a: { mime: 'audio/mp4', ext: 'm4a' },
} as const;

type Built = { raw: RawTrack; def: AlbumDef; title: string; hint: Hint };

function makeFeatures(id: string, p: Profile, hint: Hint): TrackFeatures {
  const rng = mulberry32(hashString(`features|${id}`));
  const h = HINTS[hint];
  const jitter = (x: number, amount = 0.05) => x + (rng() - 0.5) * 2 * amount;
  const energy = clampUnit(jitter(p.e + (h.e ?? 0)));
  const bass = clampUnit(jitter(p.b + (h.b ?? 0)));
  return {
    v: 1,
    bpm: round(jitter(p.bpm + (h.bpm ?? 0), 6), 1),
    bpmConfidence: round(0.6 + rng() * 0.35, 2),
    energy: round(energy),
    loudnessLufs: round(-15 + energy * 8 + (rng() - 0.5) * 2, 1),
    peak: round(0.88 + rng() * 0.12),
    dynamics: round(clampUnit(0.85 - energy * 0.6 + (rng() - 0.5) * 0.1)),
    bass: round(bass),
    subBass: round(clampUnit(bass * 0.8 + (rng() - 0.5) * 0.1)),
    brightness: round(clampUnit(jitter(p.br + (energy - 0.5) * 0.2))),
    flatness: round(0.1 + rng() * 0.2),
    danceability: round(clampUnit(jitter(p.d + (h.d ?? 0)))),
    valence: round(clampUnit(jitter(p.v + (h.v ?? 0)))),
    acousticness: round(clampUnit(jitter(p.a + (h.a ?? 0)))),
    key: Math.floor(rng() * 12),
    mode: hint === 'sad' ? 0 : hint === 'party' ? 1 : rng() < 0.5 ? 0 : 1,
    keyConfidence: round(0.4 + rng() * 0.5, 2),
    onsetRate: round(1 + energy * 5 + rng(), 2),
  };
}

function buildTracks(): Built[] {
  const out: Built[] = [];
  ALBUMS.forEach((def, ai) => {
    const fmt = FORMATS[def.format ?? 'mp3'];
    def.tracks.forEach((row, ti) => {
      const [title, artist, sec, hint = '', year = def.year, fileOverride] = row;
      const id = String(1001 + out.length);
      const durationMs = sec * 1000 + (hashString(id) % 1000);
      const split = def.discSplit;
      const track = def.untagged ? 0 : split ? (Math.floor(ti / split) + 1) * 1000 + (ti % split) + 1 : ti + 1;
      const dateAdded = SAMPLE_NOW - def.addedDaysAgo * DAY - ti * 7 * MINUTE;
      const sizeKbps = def.kbps || (def.format === 'flac' ? 1000 : 320);
      const base = def.untagged ? title.replace(/\s+/g, '_') : title.replace(/[\\/:*?"<>|]/g, '-');
      out.push({
        def,
        title,
        hint,
        raw: {
          id,
          title,
          artist,
          album: def.album,
          albumId: def.noAlbumId ? '' : String(101 + ai),
          albumArtist: def.albumArtist,
          genre: def.genre,
          year,
          track,
          disc: 0,
          durationMs,
          folder: def.folder,
          fileName: fileOverride ?? `${base}.${fmt.ext}`,
          mime: fmt.mime,
          bitrate: def.kbps * 1000,
          size: Math.round(sizeKbps * 125 * (durationMs / 1000)) + 48_000,
          dateAdded,
          dateModified: dateAdded - 3 * DAY,
        },
      });
    });
  });
  return out;
}

// Local-time listening habits: mostly late evenings, a commute bump, a lunchtime bump.
const HOUR_WEIGHTS = [6, 5, 3, 1, 0, 0, 0, 1, 2, 2, 1, 1, 2, 2, 1, 1, 1, 2, 3, 3, 4, 6, 8, 8];
const HOURS = HOUR_WEIGHTS.map((_, i) => i);
const isNight = (hour: number) => hour >= 21 || hour < 3;

function buildPlays(tracks: Built[]): PlayEvent[] {
  const rng = mulberry32(hashString('thrum-sample-plays'));
  const anchor = new Date(SAMPLE_NOW);
  const plays: PlayEvent[] = [];
  const weightOf = (b: Built, at: number, hour: number, daysAgo: number): number => {
    const { def } = b;
    if (b.raw.dateAdded > at) return 0;
    if (def.playDays && (daysAgo < def.playDays[0] || daysAgo > def.playDays[1])) return 0;
    let w = def.taste * (isNight(hour) ? (def.nightTaste ?? 1) : 1);
    if (FAVOURITES.has(b.title)) w *= 3;
    if (def.addedDaysAgo <= 30) w *= 2;
    return w;
  };
  const session = (start: number, count: number, daysAgo: number) => {
    const hour = new Date(start).getHours();
    let at = start;
    let last = '';
    for (let i = 0; i < count; i++) {
      const pick = pickWeighted(tracks, (b) => (b.raw.id === last ? 0 : weightOf(b, at, hour, daysAgo)), rng);
      if (!pick) return;
      last = pick.raw.id;
      const dur = pick.raw.durationMs;
      const r = rng();
      const skipped = r < 0.12;
      const playedMs = skipped
        ? Math.round(4000 + rng() * 20000)
        : r < 0.24
          ? Math.round(dur * (0.6 + rng() * 0.35))
          : dur;
      plays.push({ trackId: pick.raw.id, startedAt: at, playedMs, durationMs: dur, completed: playedMs >= dur, skipped });
      at += playedMs + Math.round(1500 + rng() * 6000);
    }
  };
  for (let d = 89; d >= 1; d--) {
    // The last 12 days are an unbroken streak; earlier days are patchier.
    if (d > 12 && rng() < 0.22) continue;
    const date = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - d);
    const weekend = date.getDay() === 5 || date.getDay() === 6;
    const count = 1 + (rng() < 0.55 ? 1 : 0) + (weekend && rng() < 0.5 ? 1 : 0);
    // Recent weeks lean even harder into late nights.
    const weights = HOUR_WEIGHTS.map((w, h) => (d <= 30 && isNight(h) ? w * 2 : w));
    const hours: number[] = [];
    for (let s = 0; s < count; s++) {
      const h = pickWeighted(HOURS, (i) => weights[i], rng);
      if (h === undefined) break;
      weights[h] = 0;
      hours.push(h);
    }
    hours.sort((a, b) => a - b);
    for (const h of hours) {
      const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, Math.floor(rng() * 20)).getTime();
      session(start, 3 + Math.floor(rng() * 4), d);
    }
  }
  // Tonight's session, still going: gives the "played in the last 3 hours" rules something to do.
  session(SAMPLE_NOW - 150 * MINUTE, 6, 0);
  return plays.filter((p) => p.startedAt < SAMPLE_NOW).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Deterministic demo library for the web preview and tests: ~90 tracks across Bollywood, Punjabi,
 * Bengali, indie, lo-fi, hip-hop, EDM, pop and Sufi, with messy tags, analysed features for most
 * tracks and ~600 plays over the 90 days before SAMPLE_NOW (play times are in local time).
 */
export function sampleLibrary(): { raw: RawTrack[]; features: Record<string, TrackFeatures>; plays: PlayEvent[] } {
  const built = buildTracks();
  const features: Record<string, TrackFeatures> = {};
  for (const b of built) {
    if (!b.def.noFeatures) features[b.raw.id] = makeFeatures(b.raw.id, PROFILES[b.def.profile], b.hint);
  }
  return { raw: built.map((b) => b.raw), features, plays: buildPlays(built) };
}
