import type { Palette, RawTrack, SoundParams, TrackFeatures } from '../../modules/thrum-audio/src/ThrumAudio.types';

export type { Palette, RawTrack, SoundParams, TrackFeatures };

/** A cleaned-up library track. Strings are never empty: unknowns become "Unknown artist" etc. */
export type Track = {
  id: string;
  title: string;
  /** Display artist line, e.g. "Arijit Singh, Shreya Ghoshal". */
  artist: string;
  /** Individual credited artists, primary first. */
  artists: string[];
  album: string;
  albumId: string;
  albumArtist: string;
  /** Genre as tagged (cleaned), '' when untagged. */
  genre: string;
  year: number | null;
  trackNo: number | null;
  discNo: number | null;
  durationMs: number;
  folder: string;
  fileName: string;
  mime: string;
  bitrate: number | null;
  size: number;
  dateAdded: number;
  dateModified: number;
};

export type Album = {
  id: string;
  title: string;
  artist: string;
  year: number | null;
  /** Ordered by disc, then track number, then title. */
  trackIds: string[];
  durationMs: number;
  /** Track used to fetch artwork. */
  coverTrackId: string;
  dateAdded: number;
};

export type Artist = {
  /** Normalized name, used as the route param. */
  id: string;
  name: string;
  trackIds: string[];
  albumIds: string[];
};

export type Genre = {
  id: string;
  name: string;
  trackIds: string[];
};

export type Folder = {
  /** The folder path, e.g. "Music/Old Hindi/". */
  id: string;
  name: string;
  trackIds: string[];
};

export type Library = {
  tracks: Track[];
  byId: Map<string, Track>;
  albums: Album[];
  albumById: Map<string, Album>;
  artists: Artist[];
  artistById: Map<string, Artist>;
  genres: Genre[];
  folders: Folder[];
  totalDurationMs: number;
};

export type Features = TrackFeatures;

export type PlayEvent = {
  trackId: string;
  /** Epoch ms when the listen started. */
  startedAt: number;
  playedMs: number;
  durationMs: number;
  completed: boolean;
  skipped: boolean;
};

export type TrackStat = {
  trackId: string;
  plays: number;
  skips: number;
  totalMs: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
};

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
};

export type MoodId =
  | 'chill'
  | 'energetic'
  | 'happy'
  | 'sad'
  | 'romantic'
  | 'focus'
  | 'party'
  | 'workout'
  | 'latenight'
  | 'devotional'
  | 'bass'
  | 'acoustic'
  | 'drive'
  | 'sleep';

export type Range = [number, number];

export type Mood = {
  id: MoodId;
  label: string;
  /** One short evocative line, e.g. "Low lights, slow drums". */
  blurb: string;
  /** Hex colour used for the mood tile gradient. */
  color: string;
  /** A second hex colour for the gradient. */
  color2: string;
  /** Feature targets; absent keys don't matter for this mood. */
  target: {
    energy?: Range;
    valence?: Range;
    bpm?: Range;
    bass?: Range;
    acousticness?: Range;
    danceability?: Range;
  };
  /** Genre families (see moods.genreFamily) that suggest this mood when features are missing. */
  genres: string[];
  /** Words in titles/albums/genres that suggest this mood, e.g. "lofi", "unplugged", "remix". */
  keywords: string[];
  /** Words the vibe parser maps to this mood, e.g. ["chill", "relax", "calm", "mellow"]. */
  synonyms: string[];
};

export type PersonalFilter = 'favorites' | 'most-played' | 'recent' | 'forgotten' | 'new' | 'never-played';

export type VibeChip = {
  kind: 'mood' | 'tempo' | 'energy' | 'era' | 'genre' | 'personal' | 'duration' | 'bass' | 'similar' | 'text';
  label: string;
  /** The words of the input this chip was parsed from. */
  source: string;
};

export type VibeQuery = {
  /** Words left over after parsing, matched as text. */
  text: string;
  moods: MoodId[];
  energy: Range | null;
  valence: Range | null;
  bpm: Range | null;
  bassHeavy: boolean;
  era: Range | null;
  genres: string[];
  personal: PersonalFilter[];
  durationMs: Range | null;
  /** Track id whose sound to match ("songs like <title>"). */
  similarTo: string | null;
  chips: VibeChip[];
};

export type VibeContext = {
  lib: Library;
  features: Map<string, Features>;
  stats: Map<string, TrackStat>;
  favorites: Set<string>;
  now: number;
};

export type ScoredTrack = { id: string; score: number };

export type SearchHitKind = 'track' | 'album' | 'artist' | 'playlist' | 'genre' | 'folder';

export type SearchHit = { kind: SearchHitKind; id: string; score: number };

export type SearchResults = {
  query: string;
  top: SearchHit | null;
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
  genres: Genre[];
};

export type SoundPreset = {
  id: string;
  name: string;
  blurb: string;
  params: Partial<SoundParams>;
};

export type QueueState = {
  ids: string[];
  index: number;
  /** Order before shuffling, so shuffle can be undone; null when not shuffled. */
  original: string[] | null;
};

export type Daypart = {
  id: 'dawn' | 'morning' | 'afternoon' | 'evening' | 'night' | 'latenight';
  label: string;
};

export type Daylist = {
  title: string;
  subtitle: string;
  daypart: Daypart;
  moods: MoodId[];
  trackIds: string[];
};

export type StatsRange = 'week' | 'month' | 'year' | 'all';

export type RankedEntry = { id: string; label: string; plays: number; ms: number };

export type Stats = {
  range: StatsRange;
  minutes: number;
  plays: number;
  skips: number;
  uniqueTracks: number;
  topTracks: RankedEntry[];
  topArtists: RankedEntry[];
  topAlbums: RankedEntry[];
  topGenres: RankedEntry[];
  /** Plays per hour of day, 24 entries. */
  clock: number[];
  /** Plays per weekday, Monday first, 7 entries. */
  weekdays: number[];
  streakDays: number;
  longestStreak: number;
  /** "Night owl", "Early bird", ... derived from the clock. */
  persona: string;
};

export type CoverSpec = {
  colors: [string, string, string];
  angle: number;
  shape: 'orb' | 'rings' | 'grid' | 'wave' | 'stripes';
  rotation: number;
  initials: string;
};
