export type PermissionStatus = 'granted' | 'denied' | 'undetermined';

export type PermissionResult = {
  status: PermissionStatus;
  canAskAgain: boolean;
};

/** One row of the MediaStore audio table, as returned (JSON-encoded) by `scanLibrary`. Unknown numbers are 0. */
export type RawTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  albumArtist: string;
  genre: string;
  year: number;
  /** Raw MediaStore track column; some devices encode the disc as `disc * 1000 + track`. */
  track: number;
  disc: number;
  durationMs: number;
  /** Folder path relative to the storage root, e.g. `Music/Arijit Singh/`. */
  folder: string;
  fileName: string;
  mime: string;
  /** Bits per second, 0 when MediaStore doesn't know. */
  bitrate: number;
  size: number;
  /** Epoch milliseconds. */
  dateAdded: number;
  /** Epoch milliseconds. */
  dateModified: number;
};

export type ScanOptions = {
  minDurationMs: number;
  excludedFolders: string[];
};

/** Hex colours (`#RRGGBB`) extracted from the artwork by androidx.palette. */
export type Palette = {
  dominant: string | null;
  vibrant: string | null;
  darkVibrant: string | null;
  lightVibrant: string | null;
  muted: string | null;
  darkMuted: string | null;
  lightMuted: string | null;
};

export type ArtworkSize = 'sm' | 'lg';

export type ArtworkResult = {
  /** `file://` URI of the cached JPEG, or null when the track has no artwork. */
  uri: string | null;
  palette: Palette | null;
};

export type QueueItem = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  durationMs: number;
  artworkUri?: string | null;
  /** Leveling gain in dB (attenuation only, <= 0), applied when leveling is on. */
  gainDb?: number | null;
};

export type RepeatMode = 'off' | 'all' | 'one';

export type PlayerStatus = 'idle' | 'buffering' | 'ready' | 'ended';

export type PlaybackState = {
  status: PlayerStatus;
  /** True while audio is actually advancing. */
  playing: boolean;
  playWhenReady: boolean;
  index: number;
  trackId: string | null;
  positionMs: number;
  durationMs: number;
  repeat: RepeatMode;
  speed: number;
  pitch: number;
  skipSilence: boolean;
  /** Incremented whenever the native queue changes. */
  queueVersion: number;
  queueLength: number;
  leveling: boolean;
  error: string | null;
};

export type SleepMode = 'time' | 'track';

export type SleepState = {
  /** Epoch ms when playback will stop, or null when no timer is set (or mode is `track`). */
  endsAt: number | null;
  mode: SleepMode | null;
  fadeSec: number;
};

/** 10-band graphic EQ centres in Hz, shared by the native engine and the JS curve renderer. */
export type SoundParams = {
  enabled: boolean;
  /** Manual preamp, -12..+6 dB. */
  preampDb: number;
  /** Lower the preamp automatically by 0.75x the largest boost so boosts don't clip. */
  autoHeadroom: boolean;
  /** 10 gains in dB (-12..+12) at 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k Hz. */
  bands: number[];
  /** Low-shelf bass boost, 0..12 dB. */
  bassDb: number;
  /** Low-shelf corner, 40..150 Hz. */
  bassFreq: number;
  /** Psychoacoustic bass (added harmonics) 0..1, makes bass audible on small drivers. */
  phantom: number;
  /** 22 Hz high-pass that removes inaudible rumble and protects small drivers. */
  rumble: boolean;
  /** High-shelf treble, -6..+6 dB. */
  trebleDb: number;
  /** Stereo width 0 (mono)..1 (original)..2 (extra wide). */
  width: number;
  /** -1 (left)..1 (right), constant power. */
  balance: number;
  /** Transparent lookahead limiter with a -0.3 dBFS ceiling. */
  limiter: boolean;
};

export type RouteKind = 'speaker' | 'wired' | 'bluetooth' | 'usb' | 'other';

export type AudioRoute = {
  kind: RouteKind;
  name: string;
  /** Stable key used for per-device sound profiles, e.g. `bluetooth:Galaxy Buds2 Pro`. */
  key: string;
};

export type SoundState = {
  params: SoundParams;
  route: AudioRoute;
  perDevice: boolean;
  /** Saved profiles keyed by `AudioRoute.key`. */
  profiles: Record<string, SoundParams>;
  /** Headroom the engine is currently applying (<= 0 dB). */
  headroomDb: number;
  /** Hold-to-compare: the untouched signal. Momentary, so it is never persisted. */
  bypass: boolean;
};

export type Spectrum = {
  /** 48 log-spaced bands, 30 Hz..16 kHz, 0..1. */
  bands: number[];
  /** Kick/bass pulse 0..1 with automatic gain, made for animations. */
  bass: number;
  /** Output peak level over the last block in dBFS. */
  peakDb: number;
  /** Limiter gain reduction in dB (>= 0). */
  reductionDb: number;
};

export type TrackFeatures = {
  v: number;
  bpm: number;
  bpmConfidence: number;
  /** 0..1 perceived intensity. */
  energy: number;
  loudnessLufs: number;
  /** Linear sample peak 0..1. */
  peak: number;
  /** 0 (squashed)..1 (very dynamic). */
  dynamics: number;
  /** Share of energy below 150 Hz, 0..1 (normalized for typical music). */
  bass: number;
  /** Share of energy below 60 Hz, 0..1 (normalized for typical music). */
  subBass: number;
  /** Spectral centroid mapped to 0..1. */
  brightness: number;
  /** Spectral flatness 0 (tonal)..1 (noisy). */
  flatness: number;
  danceability: number;
  /** 0 (dark/sad)..1 (bright/happy). */
  valence: number;
  acousticness: number;
  /** Pitch class 0 (C)..11 (B), -1 if unknown. */
  key: number;
  /** 1 major, 0 minor. */
  mode: number;
  keyConfidence: number;
  /** Detected onsets per second. */
  onsetRate: number;
};

export type AnalysisItem = { id: string; durationMs: number };

export type AnalysisEvent = {
  id: string;
  features: TrackFeatures | null;
  error?: string | null;
  remaining: number;
};

export type TagResult = {
  /** Plain lyrics or LRC text (when `synced`). */
  lyrics: string | null;
  synced: boolean;
  replayGainTrackDb: number | null;
  replayGainAlbumDb: number | null;
  replayGainPeak: number | null;
  sampleRate: number | null;
  channels: number | null;
  bitDepth: number | null;
  codec: string | null;
  bitrate: number | null;
};

export type QueueEvent = { version: number; index: number; length: number };

export type RouteEvent = { route: AudioRoute; sound: SoundState };

export type ErrorEvent = { message: string; code: string; trackId: string | null };

export type ThrumAudioEvents = {
  onPlayback: (state: PlaybackState) => void;
  onQueue: (event: QueueEvent) => void;
  onRoute: (event: RouteEvent) => void;
  onSleep: (state: SleepState) => void;
  onLibraryChanged: (event: Record<string, never>) => void;
  onAnalysis: (event: AnalysisEvent) => void;
  onError: (event: ErrorEvent) => void;
};
