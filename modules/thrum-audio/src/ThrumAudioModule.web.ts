import { NativeModule, registerWebModule } from 'expo';

import type {
  AnalysisItem,
  ArtworkResult,
  AudioRoute,
  PermissionResult,
  PlaybackState,
  QueueItem,
  RepeatMode,
  RouteKind,
  ScanOptions,
  SleepMode,
  SleepState,
  SoundParams,
  SoundState,
  Spectrum,
  TagResult,
  ThrumAudioEvents,
} from './ThrumAudio.types';
import type { ThrumAudioModule } from './ThrumAudioModule';
import { AnalysisSim } from './web/analysis';
import { paletteFor, scanTracks } from './web/library';
import { PlayerSim } from './web/player';
import { DEMO_ROUTE, routeOf, SoundSim } from './web/sound';
import { SpectrumSynth, type SpectrumInput } from './web/spectrum';
import { tagsFor } from './web/tags';

/** About as long as the MediaStore query takes on a phone. */
const SCAN_MS = 150;
/** The demo headset reports in shortly after start-up. */
const ROUTE_MS = 250;

const GRANTED: PermissionResult = { status: 'granted', canAskAgain: true };
const NO_SLEEP: SleepState = { endsAt: null, mode: null, fadeSec: 0 };
const NO_TAGS: TagResult = {
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

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Async functions of the simulation always resolve; bad input is ignored like the native validation does. */
const settle = <T>(fn: () => T, fallback: T): Promise<T> => Promise.resolve(attempt(fn, fallback));
const run = (fn: () => void): Promise<void> => settle(fn, undefined);
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Web stand-in for the Android module so the app runs as a browser demo: the sample library, a
 * silent player with the native queue/transport/repeat/sleep semantics, in-memory sound settings on a
 * pretend Bluetooth headset, a synthesized analyser that follows the EQ, and quick fake analysis.
 */
class ThrumAudioWeb extends NativeModule<ThrumAudioEvents> implements ThrumAudioModule {
  private readonly sound = new SoundSim();
  private readonly player = new PlayerSim({
    playback: (state) => this.emit('onPlayback', state),
    queue: (event) => this.emit('onQueue', event),
    sleep: (state) => this.emit('onSleep', state),
  });
  private readonly analysis = new AnalysisSim((event) => this.emit('onAnalysis', event));
  private readonly spectrum = new SpectrumSynth();
  private readonly frame: SpectrumInput = {
    playing: false,
    trackId: null,
    positionMs: 0,
    durationMs: 0,
    pitch: 1,
    fade: 1,
    gainDb: 0,
  };
  private routeAnnounced = false;

  startObserving<EventName extends keyof ThrumAudioEvents>(eventName: EventName): void {
    if (eventName === 'onRoute') this.announceRoute();
  }

  // region permissions + library

  getPermissionStatus(): Promise<PermissionResult> {
    return Promise.resolve({ ...GRANTED });
  }

  requestPermission(): Promise<PermissionResult> {
    return Promise.resolve({ ...GRANTED });
  }

  async scanLibrary(options: ScanOptions): Promise<string> {
    await delay(SCAN_MS);
    return attempt(() => JSON.stringify(scanTracks(options)), '[]');
  }

  /** There are no image files on the web: no uri (the UI draws its generated cover) plus that cover's colours. */
  getArtwork(albumId: string, trackId: string): Promise<ArtworkResult> {
    return settle<ArtworkResult>(
      () => ({ uri: null, palette: paletteFor(text(albumId), text(trackId)) }),
      { uri: null, palette: null },
    );
  }

  clearArtworkCache(): Promise<void> {
    return Promise.resolve();
  }

  // endregion

  // region queue + transport

  setQueue(items: QueueItem[], startIndex: number, startPositionMs: number, playWhenReady: boolean): Promise<void> {
    return run(() => this.player.setQueue(items, startIndex, startPositionMs, playWhenReady));
  }

  reorderQueue(items: QueueItem[], currentIndex: number): Promise<void> {
    return run(() => this.player.reorderQueue(items, currentIndex));
  }

  addItems(items: QueueItem[], atIndex: number): Promise<void> {
    return run(() => this.player.addItems(items, atIndex));
  }

  removeItem(index: number): Promise<void> {
    return run(() => this.player.removeItem(index));
  }

  moveItem(from: number, to: number): Promise<void> {
    return run(() => this.player.moveItem(from, to));
  }

  play(): Promise<void> {
    return run(() => this.player.play());
  }

  pause(): Promise<void> {
    return run(() => this.player.pause());
  }

  togglePlay(): Promise<void> {
    return run(() => this.player.togglePlay());
  }

  seekTo(positionMs: number): Promise<void> {
    return run(() => this.player.seekTo(positionMs));
  }

  next(): Promise<void> {
    return run(() => this.player.next());
  }

  previous(): Promise<void> {
    return run(() => this.player.previous());
  }

  skipTo(index: number, positionMs: number): Promise<void> {
    return run(() => this.player.skipTo(index, positionMs));
  }

  setRepeatMode(mode: RepeatMode): Promise<void> {
    return run(() => this.player.setRepeatMode(mode));
  }

  setSpeed(speed: number, pitch: number): Promise<void> {
    return run(() => this.player.setSpeed(speed, pitch));
  }

  setSkipSilence(enabled: boolean): Promise<void> {
    return run(() => this.player.setSkipSilence(enabled));
  }

  setLeveling(enabled: boolean): Promise<void> {
    return run(() => this.player.setLeveling(enabled));
  }

  setItemGain(id: string, gainDb: number | null): Promise<void> {
    return run(() => this.player.setItemGain(id, gainDb));
  }

  stop(): Promise<void> {
    return run(() => this.player.stop());
  }

  getState(): PlaybackState {
    return this.player.state();
  }

  getPosition(): number {
    return this.player.position();
  }

  getQueue(): QueueItem[] {
    return this.player.queue();
  }

  /** Nothing is persisted on the web; like native, a player that already has a queue counts as restored. */
  restoreSession(): Promise<boolean> {
    return settle(() => this.player.hasItems(), false);
  }

  // endregion

  // region sleep timer

  setSleepTimer(minutes: number, mode: SleepMode, fadeSec: number): Promise<SleepState> {
    return settle(() => this.player.setSleep(minutes, mode, fadeSec), NO_SLEEP);
  }

  cancelSleepTimer(): Promise<SleepState> {
    return settle(() => this.player.cancelSleep(), NO_SLEEP);
  }

  getSleepTimer(): SleepState {
    return this.player.sleep();
  }

  // endregion

  // region sound

  getSoundState(): SoundState {
    this.announceRoute();
    return this.sound.state();
  }

  setSound(params: SoundParams): SoundState {
    return attempt(() => this.sound.set(params), this.sound.state());
  }

  setPerDevice(enabled: boolean): SoundState {
    return this.sound.setPerDevice(enabled === true);
  }

  setBypass(bypass: boolean): SoundState {
    return this.sound.setBypass(bypass === true);
  }

  getSpectrum(): Spectrum | null {
    return attempt(() => this.spectrum.frame(this.player.spectrumInput(this.frame), this.sound), null);
  }

  /**
   * Web-only test hook: pretend the output changed, e.g. `simulateRoute('speaker')` or
   * `simulateRoute('bluetooth', 'Pixel Buds Pro')`, to exercise per-device sound profiles.
   */
  simulateRoute(kind: RouteKind, name?: string): SoundState {
    const route = routeOf(kind, name);
    return route.key === this.sound.route.key ? this.sound.state() : this.changeRoute(route);
  }

  // endregion

  // region analysis + tags

  analyze(items: AnalysisItem[]): Promise<void> {
    return run(() => this.analysis.enqueue(items));
  }

  cancelAnalysis(): void {
    this.analysis.cancel();
  }

  readTags(id: string): Promise<TagResult> {
    return settle(() => tagsFor(text(id)), { ...NO_TAGS });
  }

  // endregion

  /** The pretend headset reports once, so listeners see a route event like after a real connection. */
  private announceRoute(): void {
    if (this.routeAnnounced) return;
    this.routeAnnounced = true;
    setTimeout(() => attempt(() => this.changeRoute(DEMO_ROUTE), null), ROUTE_MS);
  }

  /** SoundCenter.onRouteChanged: per-device mode switches to the new output's profile, then onRoute. */
  private changeRoute(route: AudioRoute): SoundState {
    const sound = this.sound.routeChanged(route);
    this.emit('onRoute', { route: { ...sound.route }, sound });
    return sound;
  }
}

export default registerWebModule(ThrumAudioWeb, 'ThrumAudio');
