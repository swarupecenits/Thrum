import type { Daypart } from './types';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const DAYPARTS: Record<Daypart['id'], Daypart> = {
  dawn: { id: 'dawn', label: 'Dawn' },
  morning: { id: 'morning', label: 'Morning' },
  afternoon: { id: 'afternoon', label: 'Afternoon' },
  evening: { id: 'evening', label: 'Evening' },
  night: { id: 'night', label: 'Night' },
  latenight: { id: 'latenight', label: 'Late night' },
};

export function daypartOfHour(hour: number): Daypart {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h < 5) return DAYPARTS.latenight;
  if (h < 8) return DAYPARTS.dawn;
  if (h < 12) return DAYPARTS.morning;
  if (h < 17) return DAYPARTS.afternoon;
  if (h < 21) return DAYPARTS.evening;
  return DAYPARTS.night;
}

/** dawn 5-8, morning 8-12, afternoon 12-17, evening 17-21, night 21-24, latenight 0-5 (local time). */
export function daypart(date: Date): Daypart {
  return daypartOfHour(date.getHours());
}

/** Local calendar day number (DST-safe), so consecutive days differ by exactly 1. */
export function dayIndex(ts: number): number {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** Local date as YYYY-MM-DD. */
export function localDateKey(date: Date): string {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return `${date.getFullYear()}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** 0 = Monday .. 6 = Sunday. */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Circular distance between two hours of the day (0..12). */
export function hourDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return d > 12 ? 24 - d : d;
}
