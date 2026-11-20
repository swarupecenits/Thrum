import { create } from 'zustand';

import { persist } from './persist';
import { saveSetting } from '@/db/repos';
import type { AlbumSort, TrackSort } from '@/lib/library';
import type { AccentId, ThemeId } from '@/theme/palette';

export type LibrarySection = 'tracks' | 'albums' | 'artists' | 'playlists' | 'folders' | 'genres';
export type ShuffleMode = 'spread' | 'flow';

export type Settings = {
  onboarded: boolean;
  /** First name for the greeting; optional. */
  name: string;
  theme: ThemeId;
  accent: AccentId;
  haptics: boolean;
  /** Artwork breathes with the kick drum while music plays. */
  artPulse: boolean;
  /** Tracks shorter than this are treated as ringtones/voice notes and hidden. */
  minDurationSec: number;
  excludedFolders: string[];
  leveling: boolean;
  skipSilence: boolean;
  shuffleMode: ShuffleMode;
  /** Analyze tracks in the background so vibe search can use tempo, energy and bass. */
  autoAnalyze: boolean;
  section: LibrarySection;
  trackSort: TrackSort;
  trackSortDesc: boolean;
  albumSort: AlbumSort;
  sleepFadeSec: number;
};

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  name: '',
  theme: 'ink',
  accent: 'lime',
  haptics: true,
  artPulse: true,
  minDurationSec: 30,
  excludedFolders: [],
  leveling: false,
  skipSilence: false,
  shuffleMode: 'spread',
  autoAnalyze: true,
  section: 'tracks',
  trackSort: 'title',
  trackSortDesc: false,
  albumSort: 'title',
  sleepFadeSec: 20,
};

const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    typeof v === 'string' && (values as string[]).includes(v);

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= 60;
const between = (lo: number, hi: number) => (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isFolders = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 200 && v.every((x) => typeof x === 'string');

const CHECKS: { [K in keyof Settings]: (v: unknown) => v is Settings[K] } = {
  onboarded: isBool,
  name: isText,
  theme: oneOf<ThemeId>('ink', 'amoled'),
  accent: oneOf<AccentId>('lime', 'adaptive', 'violet', 'coral', 'sky', 'amber', 'mint'),
  haptics: isBool,
  artPulse: isBool,
  minDurationSec: between(0, 600),
  excludedFolders: isFolders,
  leveling: isBool,
  skipSilence: isBool,
  shuffleMode: oneOf<ShuffleMode>('spread', 'flow'),
  autoAnalyze: isBool,
  section: oneOf<LibrarySection>('tracks', 'albums', 'artists', 'playlists', 'folders', 'genres'),
  trackSort: oneOf<TrackSort>('title', 'artist', 'album', 'added', 'year', 'duration', 'plays'),
  trackSortDesc: isBool,
  albumSort: oneOf<AlbumSort>('title', 'artist', 'year', 'added'),
  sleepFadeSec: between(0, 120),
};

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[];

/** Stored rows are JSON; anything unreadable or out of range falls back to the default. */
export function readSettings(rows: Record<string, string>, base: Settings = DEFAULT_SETTINGS): Settings {
  const out = { ...base } as Record<keyof Settings, unknown>;
  for (const key of KEYS) {
    const raw = rows[`s.${key}`];
    if (raw === undefined) continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (CHECKS[key](value)) out[key] = value;
    } catch {
      // keep the default
    }
  }
  return out as Settings;
}

type SettingsStore = Settings & {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
};

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...DEFAULT_SETTINGS,
  set(key, value) {
    const prev = get()[key];
    if (Object.is(prev, value)) return;
    set({ [key]: value } as Partial<Settings>);
    if (!persist(() => saveSetting(`s.${key}`, value))) set({ [key]: prev } as Partial<Settings>);
  },
}));

export function settingsSnapshot(): Settings {
  const s = useSettings.getState();
  const out = {} as Record<keyof Settings, unknown>;
  for (const key of KEYS) out[key] = s[key];
  return out as Settings;
}
