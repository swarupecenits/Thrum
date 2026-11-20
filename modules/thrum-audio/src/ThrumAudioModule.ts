import { NativeModule, requireNativeModule } from 'expo';

import type {
  AnalysisItem,
  ArtworkResult,
  ArtworkSize,
  PermissionResult,
  PlaybackState,
  QueueItem,
  RepeatMode,
  ScanOptions,
  SleepMode,
  SleepState,
  SoundParams,
  SoundState,
  Spectrum,
  TagResult,
  ThrumAudioEvents,
} from './ThrumAudio.types';

export declare class ThrumAudioModule extends NativeModule<ThrumAudioEvents> {
  getPermissionStatus(): Promise<PermissionResult>;
  requestPermission(): Promise<PermissionResult>;

  /** Resolves to a JSON array of `RawTrack`. */
  scanLibrary(options: ScanOptions): Promise<string>;
  getArtwork(albumId: string, trackId: string, size: ArtworkSize): Promise<ArtworkResult>;
  clearArtworkCache(): Promise<void>;

  setQueue(items: QueueItem[], startIndex: number, startPositionMs: number, playWhenReady: boolean): Promise<void>;
  /** Replaces everything around the current item without interrupting it. */
  reorderQueue(items: QueueItem[], currentIndex: number): Promise<void>;
  addItems(items: QueueItem[], atIndex: number): Promise<void>;
  removeItem(index: number): Promise<void>;
  moveItem(from: number, to: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  skipTo(index: number, positionMs: number): Promise<void>;
  setRepeatMode(mode: RepeatMode): Promise<void>;
  setSpeed(speed: number, pitch: number): Promise<void>;
  setSkipSilence(enabled: boolean): Promise<void>;
  setLeveling(enabled: boolean): Promise<void>;
  setItemGain(id: string, gainDb: number | null): Promise<void>;
  stop(): Promise<void>;

  getState(): PlaybackState;
  /** Current position in ms, extrapolated natively between player updates. */
  getPosition(): number;
  getQueue(): QueueItem[];
  /** Loads the last persisted session into an idle player (paused). Resolves true if anything was restored. */
  restoreSession(): Promise<boolean>;

  setSleepTimer(minutes: number, mode: SleepMode, fadeSec: number): Promise<SleepState>;
  cancelSleepTimer(): Promise<SleepState>;
  getSleepTimer(): SleepState;

  getSoundState(): SoundState;
  setSound(params: SoundParams): SoundState;
  setPerDevice(enabled: boolean): SoundState;
  setBypass(bypass: boolean): SoundState;
  getSpectrum(): Spectrum | null;

  analyze(items: AnalysisItem[]): Promise<void>;
  cancelAnalysis(): void;
  readTags(id: string): Promise<TagResult>;
}

export default requireNativeModule<ThrumAudioModule>('ThrumAudio');
