import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

let current = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let appState: { remove(): void } | null = null;

function tick() {
  current = Date.now();
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(tick, 30_000);
    // Timers stall in the background; catch up the moment the app is back.
    appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') tick();
    });
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
      appState?.remove();
      appState = null;
    }
  };
}

/**
 * Wall-clock time rounded down to `stepMs` in local time (so hour steps land on the local hour, even
 * in +5:30 zones), for greetings, daylists and "2 h ago" labels. Components only re-render when the
 * rounded value changes, so an hour clock costs one render an hour.
 */
export function useClock(stepMs = 60_000): number {
  const read = () => {
    const offset = new Date(current).getTimezoneOffset() * 60_000;
    return Math.floor((current - offset) / stepMs) * stepMs + offset;
  };
  return useSyncExternalStore(subscribe, read, read);
}

/** A per-second clock for live countdowns; idle (no timer at all) while `active` is false. */
export function useSecondTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      // Land just after each whole second so countdowns step in time with the clock.
      id = setTimeout(tick, 1005 - (t % 1000));
    };
    // Catch up straight away: `now` may be minutes old after a pause.
    id = setTimeout(tick, 0);
    return () => clearTimeout(id);
  }, [active]);
  return now;
}
