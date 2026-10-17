/**
 * Full-jitter exponential backoff, shared by the browser upload client and
 * the server-side storage calls. No DOM or Node APIs.
 */

export type RetryDelayOptions = {
  /** Base delay in ms for attempt 0. @default 500 */
  baseMs?: number;
  /** Upper bound in ms for any single delay. @default 30_000 */
  capMs?: number;
};

/**
 * Delay before retry number `attempt` (0-based):
 * `random(0, min(capMs, baseMs * 2 ** attempt))`.
 */
export function retryDelay(
  attempt: number,
  { baseMs = 500, capMs = 30_000 }: RetryDelayOptions = {},
  random: () => number = Math.random,
): number {
  return random() * Math.min(capMs, baseMs * 2 ** attempt);
}

/** HTTP statuses that a retry can fix. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([
  408, 429, 500, 502, 503, 504,
]);

/** S3 error codes that a retry can fix, whatever the status. */
const RETRYABLE_S3_CODES: ReadonlySet<string> = new Set([
  'RequestTimeout',
  'SlowDown',
  'InternalError',
  'ServiceUnavailable',
]);

/** S3 error codes that never succeed on a retry. */
const TERMINAL_S3_CODES: ReadonlySet<string> = new Set([
  'BadDigest',
  'EntityTooLarge',
  'InvalidArgument',
]);

/**
 * Whether a failed request may be retried. `status` 0 means the request
 * never got a response (network error); an S3 error `code` decides before
 * the status does.
 */
export function isRetryable(failure: {
  status: number;
  code?: string;
}): boolean {
  if (failure.code && TERMINAL_S3_CODES.has(failure.code)) return false;
  if (failure.code && RETRYABLE_S3_CODES.has(failure.code)) return true;
  return failure.status === 0 || RETRYABLE_STATUSES.has(failure.status);
}

/**
 * Parses a `Retry-After` header (delta seconds or an HTTP date) into ms.
 * Returns `undefined` for a missing or unparseable value.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** How `withRetry` should treat a thrown error. */
export type RetryDecision = {
  retry: boolean;
  /**
   * Server-requested wait (`Retry-After`); replaces the jittered delay when
   * set, bounded by `capMs`.
   */
  retryAfterMs?: number;
};

export type WithRetryOptions = RetryDelayOptions & {
  /** Total attempts including the first. @default 5 */
  attempts?: number;
  /** Decides per error whether to try again. */
  classify: (err: unknown) => RetryDecision;
  /** Aborting stops further attempts and rejects with the abort reason. */
  signal?: AbortSignal;
  /** Called before each wait, with the 0-based retry number. */
  onRetry?: (err: unknown, retry: number, delayMs: number) => void;
  random?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError');
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `fn` until it resolves, `classify` says stop, the attempts run out or
 * `signal` aborts. An abort is never retried. Rejects with the last error.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 5);
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    try {
      return await fn(attempt);
    } catch (err) {
      if (options.signal?.aborted) throw err;
      if (attempt + 1 >= attempts) throw err;
      const decision = options.classify(err);
      if (!decision.retry) throw err;
      const delay =
        decision.retryAfterMs === undefined
          ? retryDelay(attempt, options, options.random)
          : Math.min(decision.retryAfterMs, options.capMs ?? 30_000);
      options.onRetry?.(err, attempt, delay);
      await sleep(delay, options.signal);
    }
  }
}
