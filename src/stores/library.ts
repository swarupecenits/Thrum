import { create } from 'zustand';

import { ThrumAudio, type PermissionResult, type RawTrack } from '@/audio/native';
import { loadLibraryCache, saveLibraryCache } from '@/db/repos';
import { formatCount } from '@/lib/format';
import { buildLibrary } from '@/lib/library';
import type { Library } from '@/lib/types';
import { persist } from './persist';
import { useSettings } from './settings';
import { toast } from './toast';

export type LibraryStatus = 'boot' | 'needs-permission' | 'scanning' | 'ready' | 'error';

export const EMPTY_LIBRARY: Library = buildLibrary([]);

type LibraryState = {
  status: LibraryStatus;
  lib: Library;
  scannedAt: number | null;
  /** A rescan is running (the library may already be on screen). */
  scanning: boolean;
  error: string | null;
  permission: PermissionResult | null;
};

export const useLibrary = create<LibraryState>()(() => ({
  status: 'boot',
  lib: EMPTY_LIBRARY,
  scannedAt: null,
  scanning: false,
  error: null,
  permission: null,
}));

let lastRaw: string | null = null;
let running: Promise<void> | null = null;
let again = false;
const listeners = new Set<(lib: Library) => void>();

/** Called after the library is rebuilt (not for identical rescans). */
export function onLibraryRebuilt(fn: (lib: Library) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function parse(raw: string): RawTrack[] {
  const v: unknown = JSON.parse(raw);
  return Array.isArray(v) ? (v as RawTrack[]) : [];
}

/** Shows the cached library instantly at start-up; a background rescan refreshes it. */
export function hydrateLibrary(cache: Awaited<ReturnType<typeof loadLibraryCache>>) {
  if (!cache) return;
  try {
    const lib = buildLibrary(parse(cache.raw));
    lastRaw = cache.raw;
    useLibrary.setState({ lib, scannedAt: cache.scannedAt, status: 'ready' });
  } catch {
    lastRaw = null;
  }
}

export async function checkPermission(): Promise<PermissionResult> {
  try {
    const permission = await ThrumAudio.getPermissionStatus();
    useLibrary.setState({ permission });
    if (permission.status !== 'granted') useLibrary.setState({ status: 'needs-permission' });
    return permission;
  } catch (error) {
    const permission: PermissionResult = { status: 'undetermined', canAskAgain: true };
    useLibrary.setState({ permission, status: 'needs-permission', error: String(error) });
    return permission;
  }
}

export async function requestPermission(): Promise<PermissionResult> {
  try {
    const permission = await ThrumAudio.requestPermission();
    useLibrary.setState({ permission });
    if (permission.status === 'granted') void rescanLibrary();
    else useLibrary.setState({ status: 'needs-permission' });
    return permission;
  } catch {
    return useLibrary.getState().permission ?? { status: 'undetermined', canAskAgain: true };
  }
}

async function scanOnce() {
  const { minDurationSec, excludedFolders } = useSettings.getState();
  const hadLibrary = useLibrary.getState().lib.tracks.length > 0;
  useLibrary.setState((s) => ({ scanning: true, error: null, status: s.status === 'ready' ? 'ready' : 'scanning' }));
  try {
    const raw = await ThrumAudio.scanLibrary({ minDurationMs: Math.round(minDurationSec * 1000), excludedFolders });
    const scannedAt = Date.now();
    if (raw !== lastRaw) {
      const lib = buildLibrary(parse(raw));
      lastRaw = raw;
      persist(() => saveLibraryCache(raw, scannedAt));
      useLibrary.setState({ lib, scannedAt, status: 'ready', scanning: false });
      for (const fn of [...listeners]) fn(lib);
    } else {
      useLibrary.setState({ scannedAt, status: 'ready', scanning: false });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    useLibrary.setState({ scanning: false, error: message, status: hadLibrary ? 'ready' : 'error' });
  }
}

/** Rescans MediaStore. Calls made while a scan is running coalesce into one follow-up scan. */
export function rescanLibrary(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await scanOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

/** A rescan the user asked for: a toast says what changed, or that it failed. */
export async function rescanAndReport(): Promise<void> {
  const before = useLibrary.getState().lib.tracks.length;
  await rescanLibrary();
  const s = useLibrary.getState();
  if (s.error) {
    toast({ message: "Couldn't rescan your music", tone: 'danger', icon: 'warning' });
    return;
  }
  const diff = s.lib.tracks.length - before;
  toast({
    message:
      diff > 0
        ? `${formatCount(diff, 'new song')} found`
        : diff < 0
          ? `${formatCount(-diff, 'song')} no longer on your phone`
          : `Up to date \u00b7 ${formatCount(s.lib.tracks.length, 'song')}`,
    tone: 'success',
    icon: 'check',
  });
}
