import ThrumAudio from '../../modules/thrum-audio';

export { ThrumAudio };
export type {
  AnalysisEvent,
  ArtworkResult,
  ArtworkSize,
  AudioRoute,
  ErrorEvent,
  Palette,
  PermissionResult,
  PlaybackState,
  PlayerStatus,
  QueueEvent,
  QueueItem,
  RawTrack,
  RepeatMode,
  RouteEvent,
  RouteKind,
  SleepMode,
  SleepState,
  SoundParams,
  SoundState,
  Spectrum,
  TagResult,
  TrackFeatures,
} from '../../modules/thrum-audio';

type Reporter = (error: unknown, what: string) => void;

let reporter: Reporter = (error, what) => {
  if (__DEV__) console.warn(`[thrum] ${what} failed`, error);
};

/** Lets the UI decide how native failures surface (a toast) without the services importing UI. */
export function setNativeErrorReporter(next: Reporter) {
  reporter = next;
}

/** Fire-and-forget native call: a rejection is reported once instead of going unhandled. */
export function call(promise: Promise<unknown>, what: string) {
  promise.catch((error: unknown) => reporter(error, what));
}

/** Synchronous native call with a fallback, for getters that throw before the service connects. */
export function read<T>(fn: () => T, fallback: T): T {
  try {
    return fn() ?? fallback;
  } catch {
    return fallback;
  }
}
