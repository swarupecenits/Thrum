import { toast } from './toast';

let lastReport = 0;

/** Runs a write. If storage fails the user hears about it once, and the caller can roll back. */
export function persist(write: () => void): boolean {
  try {
    write();
    return true;
  } catch (error) {
    reportWriteError(error);
    return false;
  }
}

export function reportWriteError(error: unknown) {
  if (__DEV__) console.warn('[thrum] could not save', error);
  const now = Date.now();
  if (now - lastReport < 4000) return;
  lastReport = now;
  toast({ message: "Couldn't save that change. Please try again.", tone: 'danger', icon: 'warning' });
}
