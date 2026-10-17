import { isRetryable, parseRetryAfter } from '../utils/retry';

const FORBIDDEN_XHR_HEADERS = new Set([
  'content-length',
  'host',
  'connection',
  'user-agent',
  'referer',
  'origin',
]);

/** No progress event for this long aborts the PUT as stalled. */
export const STALL_TIMEOUT_MS = 30_000;

/** A PUT may take at most `size / 32 KiB/s`, and never less than the stall timeout. */
const MIN_THROUGHPUT_BYTES_PER_SECOND = 32 * 1024;

export type UploadRequestCode =
  | 'NETWORK_ERROR'
  | 'UPLOAD_FAILED'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_TIMEOUT';

/**
 * A failed PUT. `NETWORK_ERROR` for the XHR `error` event,
 * `UPLOAD_TIMEOUT` for a stall or a PUT over its time ceiling,
 * `UPLOAD_EXPIRED` for a 403 whose S3 error says the signature expired, and
 * `UPLOAD_FAILED` for any other non-2xx response. `s3Code` is the `<Code>` of
 * the S3 XML error body, when readable.
 */
export class UploadRequestError extends Error {
  readonly code: UploadRequestCode;
  readonly status: number;
  readonly s3Code: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly timedOut: boolean;

  constructor(
    code: UploadRequestCode,
    message: string,
    details: {
      status: number;
      s3Code?: string;
      retryAfterMs?: number;
      timedOut?: boolean;
    },
  ) {
    super(message);
    this.name = 'UploadRequestError';
    this.code = code;
    this.status = details.status;
    this.s3Code = details.s3Code;
    this.retryAfterMs = details.retryAfterMs;
    this.timedOut = details.timedOut ?? false;
  }

  /** Whether trying again can succeed. */
  get retryable(): boolean {
    if (this.code === 'UPLOAD_EXPIRED') return false;
    if (this.timedOut) return true;
    return isRetryable({ status: this.status, code: this.s3Code });
  }

  /** S3 or the CDN asked to slow down (429, or 503 `SlowDown`). */
  get throttled(): boolean {
    return (
      this.status === 429 ||
      (this.status === 503 && this.s3Code !== 'InternalError')
    );
  }
}

/** `<Code>` and `<Message>` of an S3 XML error body. */
export function parseS3Error(body: string | undefined): {
  code?: string;
  message?: string;
} {
  if (!body) return {};
  return {
    code: /<Code>([^<]*)<\/Code>/.exec(body)?.[1],
    message: /<Message>([^<]*)<\/Message>/.exec(body)?.[1],
  };
}

/**
 * True for a 403 caused by an expired presigned URL: S3 answers
 * `AccessDenied` with "Request has expired", STS credentials `ExpiredToken`.
 */
function isExpiredSignature(
  status: number,
  s3: { code?: string; message?: string },
): boolean {
  if (status !== 403) return false;
  if (s3.code === 'ExpiredToken') return true;
  return s3.code === 'AccessDenied' && /expired/i.test(s3.message ?? '');
}

function readResponseText(xhr: XMLHttpRequest): string | undefined {
  try {
    return typeof xhr.responseText === 'string' ? xhr.responseText : undefined;
  } catch {
    return undefined;
  }
}

function readRetryAfter(xhr: XMLHttpRequest): number | undefined {
  try {
    return parseRetryAfter(xhr.getResponseHeader?.('Retry-After'));
  } catch {
    return undefined;
  }
}

export function abortError(): DOMException {
  return new DOMException('Upload aborted', 'AbortError');
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * PUTs `body` with XHR (the only API with reliable upload progress).
 * Aborts with `UPLOAD_TIMEOUT` when no progress event arrives for
 * `STALL_TIMEOUT_MS`, or when the PUT runs longer than
 * `size / 32 KiB/s`; `onProgress` also fires once `loaded === total`, the
 * start of the finalizing phase.
 */
export function uploadWithXHR(
  url: string,
  body: File | Blob,
  headers: Record<string, string>,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  options: { stallMs?: number; now?: () => number } = {},
): Promise<void> {
  const stallMs = options.stallMs ?? STALL_TIMEOUT_MS;
  const ceilingMs = Math.max(
    stallMs,
    (body.size / MIN_THROUGHPUT_BYTES_PER_SECOND) * 1000,
  );

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    for (const [key, value] of Object.entries(headers)) {
      if (!FORBIDDEN_XHR_HEADERS.has(key.toLowerCase())) {
        xhr.setRequestHeader(key, value);
      }
    }

    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let ceilingTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const cleanup = () => {
      clearTimeout(stallTimer);
      clearTimeout(ceilingTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    // Settles before aborting: `abort()` fires the `abort` event
    // synchronously, which would otherwise settle first as an AbortError.
    const timeout = (message: string) => {
      settle(() =>
        reject(
          new UploadRequestError('UPLOAD_TIMEOUT', message, {
            status: 0,
            timedOut: true,
          }),
        ),
      );
      xhr.abort();
    };
    const armStall = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(
        () => timeout('The upload stalled without progress'),
        stallMs,
      );
    };
    const onAbort = () => {
      settle(() => reject(abortError()));
      xhr.abort();
    };

    signal?.addEventListener('abort', onAbort);
    armStall();
    ceilingTimer = setTimeout(
      () => timeout('The upload took longer than its size allows'),
      ceilingMs,
    );

    xhr.upload.addEventListener('progress', (event) => {
      armStall();
      if (event.lengthComputable) onProgress(event.loaded, event.total);
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle(() => resolve());
        return;
      }
      const s3 = parseS3Error(readResponseText(xhr));
      const details = {
        status: xhr.status,
        s3Code: s3.code,
        retryAfterMs: readRetryAfter(xhr),
      };
      settle(() =>
        reject(
          isExpiredSignature(xhr.status, s3)
            ? new UploadRequestError(
                'UPLOAD_EXPIRED',
                'The signed upload URL expired',
                details,
              )
            : new UploadRequestError(
                'UPLOAD_FAILED',
                `Upload failed with status ${xhr.status}`,
                details,
              ),
        ),
      );
    });
    xhr.addEventListener('error', () =>
      settle(() =>
        reject(
          new UploadRequestError(
            'NETWORK_ERROR',
            'Network error during upload',
            { status: 0 },
          ),
        ),
      ),
    );
    xhr.addEventListener('abort', () => settle(() => reject(abortError())));

    xhr.send(body);
  });
}
