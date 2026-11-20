import { AppState } from 'react-native';

import { recentlyPlayed } from '@/lib/stats';
import { useCollections } from '@/stores/collections';
import { levelingGainDb, onAnalysisEvent, startAnalysis, stopAnalysis } from '@/stores/features';
import { useHistory } from '@/stores/history';
import { checkPermission, onLibraryRebuilt, rescanLibrary, useLibrary } from '@/stores/library';
import {
  onPlaybackEvent,
  onQueueEvent,
  onSleepEvent,
  restorePlayer,
  startClockWatch,
  syncPlayer,
  usePlayer,
} from '@/stores/player';
import { useSettings } from '@/stores/settings';
import { hydrateSound, onRouteEvent, useSound } from '@/stores/sound';
import { toast } from '@/stores/toast';
import { setHapticsEnabled } from '@/utils/haptics';
import { call, setNativeErrorReporter, ThrumAudio } from './native';

let started = false;
let foreground = AppState.currentState === 'active';
let rescanTimer: ReturnType<typeof setTimeout> | null = null;
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
let lastErrorToast = 0;

function rescanSoon(delay = 1500) {
  if (rescanTimer) clearTimeout(rescanTimer);
  rescanTimer = setTimeout(() => {
    rescanTimer = null;
    if (useLibrary.getState().permission?.status === 'granted') void rescanLibrary();
  }, delay);
}

/** Queues analysis for everything new right away; favourites and recent listens go first. */
export function analyzeNow(): boolean {
  const { lib, status } = useLibrary.getState();
  if (status !== 'ready' || !lib.tracks.length) return false;
  const priority = [...useCollections.getState().favoriteOrder, ...recentlyPlayed(useHistory.getState().plays, 300)];
  startAnalysis(lib, priority);
  return true;
}

function analyzeSoon(delay = 0) {
  if (analysisTimer) clearTimeout(analysisTimer);
  analysisTimer = setTimeout(() => {
    analysisTimer = null;
    if (useSettings.getState().autoAnalyze) analyzeNow();
  }, delay);
}

function onNativeError(message: string, trackId: string | null) {
  const now = Date.now();
  if (now - lastErrorToast < 3000) return;
  lastErrorToast = now;
  const t = trackId ? useLibrary.getState().lib.byId.get(trackId) : undefined;
  const more = usePlayer.getState().ids.length > 1;
  toast({
    message: t ? `Couldn't play “${t.title}”${more ? ', skipping it' : ''}` : message || "Couldn't play that file",
    tone: 'danger',
    icon: 'warning',
  });
}

/** Wires native events to the stores. Runs once, right after the first frame. */
export function startServices() {
  if (started) return;
  started = true;

  setNativeErrorReporter((error, what) => {
    if (__DEV__) console.warn(`[thrum] ${what} failed`, error);
    toast({ message: `${what} didn't work. Please try again.`, tone: 'danger', icon: 'warning' });
  });

  ThrumAudio.addListener('onPlayback', onPlaybackEvent);
  ThrumAudio.addListener('onQueue', onQueueEvent);
  ThrumAudio.addListener('onSleep', onSleepEvent);
  ThrumAudio.addListener('onRoute', (e) => {
    const prevKey = useSound.getState().route.key;
    onRouteEvent(e);
    if (e.route.key !== prevKey && useSound.getState().perDevice) {
      toast({ message: `${e.route.name}: sound profile loaded`, icon: 'headphones', duration: 2200 });
    }
  });
  ThrumAudio.addListener('onAnalysis', (e) => {
    onAnalysisEvent(e, useLibrary.getState().lib);
    if (e.features && usePlayer.getState().ids.includes(e.id)) {
      call(ThrumAudio.setItemGain(e.id, levelingGainDb(e.id)), 'Leveling');
    }
  });
  ThrumAudio.addListener('onError', (e) => onNativeError(e.message, e.trackId));
  ThrumAudio.addListener('onLibraryChanged', () => rescanSoon());

  hydrateSound();
  void restorePlayer();
  const settings = useSettings.getState();
  call(ThrumAudio.setLeveling(settings.leveling), 'Leveling');
  call(ThrumAudio.setSkipSilence(settings.skipSilence), 'Skip silence');
  startClockWatch(() => foreground);

  onLibraryRebuilt(() => analyzeSoon(2500));
  void checkPermission().then((p) => {
    if (p.status === 'granted') void rescanLibrary();
  });
  analyzeSoon(4000);

  AppState.addEventListener('change', (state) => {
    const was = foreground;
    foreground = state === 'active';
    if (!foreground || was) return;
    syncPlayer();
    hydrateSound();
    // The permission may have been granted from system settings while we were away.
    const before = useLibrary.getState().permission?.status;
    void checkPermission().then((p) => {
      if (p.status === 'granted' && before !== 'granted') void rescanLibrary();
    });
  });

  useSettings.subscribe((s, prev) => {
    if (s.haptics !== prev.haptics) setHapticsEnabled(s.haptics);
    if (s.leveling !== prev.leveling) call(ThrumAudio.setLeveling(s.leveling), 'Leveling');
    if (s.skipSilence !== prev.skipSilence) call(ThrumAudio.setSkipSilence(s.skipSilence), 'Skip silence');
    if (s.minDurationSec !== prev.minDurationSec || s.excludedFolders !== prev.excludedFolders) rescanSoon(400);
    if (s.autoAnalyze !== prev.autoAnalyze) {
      if (s.autoAnalyze) analyzeSoon(300);
      else stopAnalysis();
    }
  });
}
