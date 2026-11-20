import type { AnalysisEvent } from '../ThrumAudio.types';
import { featuresFor } from './features';
import { finite, isRecord } from './util';

/** Roughly how long the simulated analyser spends on one track. */
const STEP_MS = 30;
/** AnalysisQueue only accepts MediaStore ids (`id.toLongOrNull() != null`). */
const MEDIA_ID = /^[+-]?\d{1,19}$/;

/**
 * AnalysisQueue without the decoding: one track at a time in request order, duplicates collapse,
 * `remaining` counts what is still queued, cancel drops everything.
 */
export class AnalysisSim {
  private readonly pending = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly emit: (event: AnalysisEvent) => void;

  constructor(emit: (event: AnalysisEvent) => void) {
    this.emit = emit;
  }

  enqueue(items: unknown): void {
    if (!Array.isArray(items)) return;
    for (const v of items) {
      if (isRecord(v) && typeof v.id === 'string' && MEDIA_ID.test(v.id)) {
        this.pending.set(v.id, Math.max(0, finite(v.durationMs, 0)));
      }
    }
    if (this.timer === null && this.pending.size) this.timer = setTimeout(this.step, STEP_MS);
  }

  cancel(): void {
    this.pending.clear();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly step = (): void => {
    this.timer = null;
    const next = this.pending.keys().next();
    if (next.done) return;
    const id = next.value;
    this.pending.delete(id);
    try {
      this.emit({ id, features: featuresFor(id), error: null, remaining: this.pending.size });
    } catch {
      // Listener errors must not stall the queue.
    }
    if (this.pending.size && this.timer === null) this.timer = setTimeout(this.step, STEP_MS);
  };
}
