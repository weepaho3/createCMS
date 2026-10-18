/**
 * Screen reader announcements for the media library: polite for progress
 * and results, assertive only for blocking failures. The functions here
 * decide when and how loudly to speak; a live region (or the editor's
 * announcer) does the speaking.
 */

export type Politeness = 'polite' | 'assertive';

export type Announce = (message: string, politeness?: Politeness) => void;

/** Progress thresholds in percent. */
export const PROGRESS_THRESHOLDS = [25, 50, 75] as const;
/** A slow batch is announced at most this often between thresholds. */
export const PROGRESS_HEARTBEAT_MS = 10_000;
/** Announcements between start and end of one batch. */
export const MAX_PROGRESS_ANNOUNCEMENTS = 5;
/** Selection changes settle this long before they are announced. */
export const SELECTION_ANNOUNCE_MS = 400;

export type ProgressAnnouncer = {
  start(message: string): void;
  /**
   * Reports `percent` (0-100) at `now` ms; `message` builds the text and
   * runs only when something is announced. A jump over several thresholds
   * (8 to 80) is one announcement, never skipped.
   */
  update(
    percent: number,
    now: number,
    message: (percent: number) => string,
  ): void;
  end(message: string, politeness?: Politeness): void;
};

export function createProgressAnnouncer(announce: Announce): ProgressAnnouncer {
  let last = 0;
  let lastAt = 0;
  let count = 0;
  let active = false;
  return {
    start(message) {
      active = true;
      last = 0;
      lastAt = Number.NEGATIVE_INFINITY;
      count = 0;
      announce(message, 'polite');
    },
    update(percent, now, message) {
      if (!active || count >= MAX_PROGRESS_ANNOUNCEMENTS) return;
      if (lastAt === Number.NEGATIVE_INFINITY) lastAt = now;
      const crossed = PROGRESS_THRESHOLDS.some(
        (threshold) => last < threshold && percent >= threshold,
      );
      const heartbeat = now - lastAt >= PROGRESS_HEARTBEAT_MS && percent > last;
      if ((crossed || heartbeat) && percent < 100) {
        count++;
        lastAt = now;
        announce(message(Math.floor(percent)), 'polite');
      }
      last = Math.max(last, percent);
    },
    end(message, politeness = 'polite') {
      if (!active) return;
      active = false;
      announce(message, politeness);
    },
  };
}

/** `aria-valuenow` for a progress bar, in 10 percent steps. */
export function progressValueNow(percent: number): number {
  return Math.min(100, Math.max(0, Math.floor(percent / 10) * 10));
}

/** Assertive only when every item of a batch failed; a partial failure stays polite. */
export function batchPoliteness(failed: number, total: number): Politeness {
  return total > 0 && failed >= total ? 'assertive' : 'polite';
}

export type DebouncedAnnouncer = {
  (message: string): void;
  cancel(): void;
  /** Speaks a pending message now. */
  flush(): void;
};

/** Announces only the last message of a burst, `delay` ms after it settles. */
export function createDebouncedAnnouncer(
  announce: Announce,
  delay = SELECTION_ANNOUNCE_MS,
): DebouncedAnnouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  const fire = () => {
    timer = null;
    if (pending !== null) announce(pending, 'polite');
    pending = null;
  };
  const debounced = ((message: string) => {
    pending = message;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(fire, delay);
  }) as DebouncedAnnouncer;
  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  debounced.flush = () => {
    if (timer !== null) clearTimeout(timer);
    fire();
  };
  return debounced;
}
