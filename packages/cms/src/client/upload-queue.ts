import type { WritableAtom } from 'nanostores';

import { atom } from 'nanostores';

import type {
  CMSFetch,
  CMSMediaDuplicateDecision,
  CMSMediaUploadFileState,
  CMSMediaUploadOptions,
  CMSMediaUploadProgress,
  CMSMediaUploadState,
  CMSMediaUploadStatus,
} from './types';
import type {
  UploadHints,
  UploadOptimizer,
  UploadRendition,
} from './upload-optimizer';

import { isRetryable, retryDelay } from '../utils/retry';
import { CMSClientError } from './error';
import { runOptimizer } from './upload-optimizer';
import {
  isAbortError,
  UploadRequestError,
  uploadWithXHR,
} from './upload-transport';

/** Connections the queue may hold at once, across every `upload()` call. */
export const CONNECTION_BUDGET = 6;
/** Files in flight at once, within the budget. */
export const MAX_ACTIVE_FILES = 4;
/** Attempts per request (PUT, sign, complete), including the first. */
export const UPLOAD_ATTEMPTS = 5;
/** A throttled budget grows back by one per this interval without throttling. */
const BUDGET_RECOVERY_MS = 30_000;
/** JSON calls (sign, complete, abort) time out after this. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Files up to this size are hashed when deduplication is on. */
export const HASH_LIMIT_BYTES = 64 * 1024 * 1024;
/** Progress shown once the bytes landed; only `success` reaches 1. */
const LANDED_PROGRESS = 0.99;
const SPEED_SAMPLE_MS = 500;
const SPEED_ALPHA = 0.2;
/** The ETA stays hidden this long after the first byte moved. */
const ETA_WARMUP_MS = 2500;
const PENDING_STORAGE_KEY = 'createcms:uploads:interrupted';
const RESUME_STORAGE_KEY = 'createcms:uploads:multipart';
/** Lifetime of a multipart upload token on the server. */
const RESUME_TTL_MS = 24 * 60 * 60 * 1000;

const ACTIVE: ReadonlySet<CMSMediaUploadStatus> = new Set([
  'queued',
  'preparing',
  'signing',
  'uploading',
  'completing',
  'retrying',
]);
const IN_FLIGHT: ReadonlySet<CMSMediaUploadStatus> = new Set([
  'preparing',
  'signing',
  'uploading',
  'completing',
  'retrying',
]);
const FINAL: ReadonlySet<CMSMediaUploadStatus> = new Set([
  'success',
  'error',
  'aborted',
]);

/** Allowed status changes; every other transition is ignored. */
const TRANSITIONS: Readonly<
  Record<CMSMediaUploadStatus, readonly CMSMediaUploadStatus[]>
> = {
  queued: ['preparing', 'paused', 'aborted'],
  preparing: ['preparing', 'signing', 'retrying', 'paused', 'error', 'aborted'],
  signing: [
    'uploading',
    'completing',
    'retrying',
    'paused',
    'error',
    'aborted',
  ],
  uploading: [
    'uploading',
    'signing',
    'completing',
    'retrying',
    'paused',
    'error',
    'aborted',
  ],
  retrying: [
    'preparing',
    'signing',
    'uploading',
    'completing',
    'paused',
    'error',
    'aborted',
  ],
  completing: ['completing', 'success', 'retrying', 'error'],
  paused: ['queued', 'success', 'aborted'],
  error: ['queued', 'aborted'],
  success: [],
  aborted: ['queued'],
};

/** Why an entry is paused: by the user, by going offline, or on a duplicate. */
type PauseReason = 'user' | 'offline' | 'duplicate';

/** The part plan of a multipart upload (`createSignedUpload` above the threshold). */
type MultipartPlan = { uploadId: string; partSize: number; partCount: number };

type Signed = {
  token: string;
  /** `null` for a multipart upload, whose parts are signed separately. */
  signedUrl: string | null;
  headers: Record<string, string>;
  assetId: string;
  multipart?: MultipartPlan | null;
};

/** Parts of one file in flight at once. */
export const PARTS_PER_FILE = 4;
/** Part URLs signed per request (the server's limit). */
const PARTS_PER_SIGN = 50;

type Internal = {
  entry: CMSMediaUploadFileState;
  /** The file as picked; `entry.file` is the optimizer's output. */
  source: File;
  controller: AbortController | null;
  pausedBy: PauseReason | null;
  signed: Signed | null;
  landed: boolean;
  /** Run the optimizer before signing. */
  runOptimizer: boolean;
  dedupe: boolean;
  revisionNote?: string;
  /** Renditions the optimizer produced; uploaded as children once the asset exists. */
  renditions: UploadRendition[];
  hints?: UploadHints;
  /** Child rendition entries of this entry. */
  children: string[];
  /** A rendition entry whose variant already existed: nothing is uploaded. */
  existing?: UploadResult;
  waiters: (() => void)[];
};

type UploadResult = { id: string; slug: string; objectKey: string };

class RequestTimeoutError extends Error {
  constructor() {
    super('The request timed out');
    this.name = 'RequestTimeoutError';
  }
}

class PauseSignal extends Error {
  constructor() {
    super('Paused');
    this.name = 'PauseSignal';
  }
}

export type UploadQueueOptions = {
  /** The optimizer published by the media-optimize plugin, if any. */
  getOptimizer?: () => UploadOptimizer | undefined;
  /** Hash files and look for duplicates before uploading. Default `false`. */
  dedupe?: boolean;
  /** Test seams: clock, waits, and the per-frame store flush. */
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  scheduleUpdate?: (flush: () => void) => void;
  /** Watch `online`/`offline`, `beforeunload` and `visibilitychange`. Default: when `window` exists. */
  browserEvents?: boolean;
  /** Downloads an asset's original for `regenerateRenditions`. Default: `fetch` with credentials. */
  fetchBlob?: (url: string) => Promise<Blob>;
  /**
   * Where unfinished multipart uploads are recorded, so picking the same
   * file after a reload resumes them; `null` records nothing. Default:
   * `localStorage` when available.
   */
  resumeStorage?: ResumeStorage | null;
};

/** The subset of `Storage` the resume records need. */
export type ResumeStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A multipart upload that can be resumed by picking the same file again. */
type ResumeRecord = {
  fingerprint: string;
  folderId: string | null;
  signed: Signed;
  expiresAt: number;
};

/** Identifies a picked file across reloads; the bytes are not read. */
function fingerprintOf(file: File): string {
  return JSON.stringify([file.name, file.size, file.lastModified]);
}

function defaultResumeStorage(): ResumeStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Unexpired records; storage errors read as none. */
function readResumeRecords(
  storage: ResumeStorage | null,
  now: number,
): ResumeRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(RESUME_STORAGE_KEY);
    const records = raw ? (JSON.parse(raw) as ResumeRecord[]) : [];
    return Array.isArray(records)
      ? records.filter((r) => r.expiresAt > now)
      : [];
  } catch {
    return [];
  }
}

function writeResumeRecords(
  storage: ResumeStorage | null,
  records: ResumeRecord[],
) {
  if (!storage) return;
  try {
    storage.setItem(RESUME_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage can be unavailable (private mode, quota); the upload still runs.
  }
}

function defaultSchedule(flush: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => flush());
  } else {
    queueMicrotask(flush);
  }
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new RequestTimeoutError()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function errorOf(err: unknown): NonNullable<CMSMediaUploadFileState['error']> {
  if (err instanceof UploadRequestError) {
    const error: NonNullable<CMSMediaUploadFileState['error']> = {
      code: err.code,
      message: err.message,
      retryable: err.retryable,
    };
    if (err.timedOut) error.timedOut = true;
    return error;
  }
  if (err instanceof RequestTimeoutError) {
    return {
      code: 'REQUEST_TIMEOUT',
      message: err.message,
      retryable: true,
      timedOut: true,
    };
  }
  if (err instanceof CMSClientError) {
    return {
      code: err.code ?? 'UPLOAD_FAILED',
      message: err.message,
      retryable: isRetryable({ status: err.status }),
    };
  }
  return {
    code: 'UPLOAD_FAILED',
    message: err instanceof Error ? err.message : 'Upload failed',
    retryable: false,
  };
}

async function sha256Base64(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  let binary = '';
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

let entrySequence = 0;

/**
 * The upload queue behind `useUploadAssets()`: one per client, shared by
 * every `upload()` and `replace()` call, so it outlives the components that
 * started uploads. Each entry runs through
 * `queued -> preparing -> signing -> uploading -> completing -> success`
 * (see `CMSMediaUploadStatus`); every status change goes through
 * `dispatch`, which ignores transitions the table does not allow.
 *
 * At most `MAX_ACTIVE_FILES` files and `CONNECTION_BUDGET` connections are
 * in flight; a 429 or 503 halves the budget, which grows back by one every
 * 30 s without throttling. Requests are retried with full-jitter backoff
 * (`retrying` carries `attempt` and `nextRetryAt`); a PUT without progress
 * for 30 s times out and retries. An expired signature is renewed once.
 * Progress stays at most 0.99 until the row exists, the store updates at
 * most once per animation frame, and `progress` carries a smoothed rate
 * and an ETA.
 */
export function createUploadQueue(
  $fetch: CMSFetch,
  options: UploadQueueOptions = {},
): WritableAtom<CMSMediaUploadState> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  const scheduleUpdate = options.scheduleUpdate ?? defaultSchedule;
  const resumeStorage =
    options.resumeStorage === undefined
      ? defaultResumeStorage()
      : options.resumeStorage;
  const items = new Map<string, Internal>();
  const order: string[] = [];
  let budget = CONNECTION_BUDGET;
  let lastThrottleAt = 0;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  let lastError: unknown = null;
  let speed: number | null = null;
  let speedTimer: ReturnType<typeof setInterval> | undefined;
  let lastSampleBytes = 0;
  let firstByteAt: number | null = null;
  let flushScheduled = false;

  const store = atom<CMSMediaUploadState>({
    isUploading: false,
    files: [],
    progress: {
      loaded: 0,
      total: 0,
      fraction: 0,
      bytesPerSecond: null,
      eta: null,
    },
    error: null,
    budget,
    upload: () => Promise.resolve([]),
    replace: () => Promise.reject(new Error('queue not ready')),
    abort: () => {},
    retry: () => {},
    pause: () => {},
    resume: () => {},
    resolveDuplicate: () => {},
    reset: () => {},
    regenerateRenditions: () => Promise.resolve([]),
  });

  // --- state and store ----------------------------------------------------

  function entries(): CMSMediaUploadFileState[] {
    return order.map((id) => items.get(id)!.entry);
  }

  function aggregate(): CMSMediaUploadProgress {
    let loaded = 0;
    let total = 0;
    let remaining = 0;
    for (const { entry } of items.values()) {
      if (entry.status === 'error' || entry.status === 'aborted') continue;
      loaded += entry.loaded;
      total += entry.total;
      if (!FINAL.has(entry.status)) remaining += entry.total - entry.loaded;
    }
    const warm = firstByteAt !== null && now() - firstByteAt >= ETA_WARMUP_MS;
    const eta =
      warm && speed !== null && speed >= 1 && remaining > 0
        ? Math.ceil(remaining / speed)
        : null;
    return {
      loaded,
      total,
      fraction: total === 0 ? 0 : Math.min(1, loaded / total),
      bytesPerSecond: speed,
      eta,
    };
  }

  function flush() {
    flushScheduled = false;
    const files = entries();
    store.set({
      ...store.get(),
      files,
      progress: aggregate(),
      isUploading: files.some((e) => ACTIVE.has(e.status)),
      error: lastError,
      budget,
    });
    syncBrowserGuards(files);
  }

  function update() {
    if (flushScheduled) return;
    flushScheduled = true;
    scheduleUpdate(flush);
  }

  function patch(id: string, change: Partial<CMSMediaUploadFileState>) {
    const item = items.get(id);
    if (!item) return;
    item.entry = { ...item.entry, ...change };
    update();
  }

  function dispatch(
    id: string,
    status: CMSMediaUploadStatus,
    change: Partial<CMSMediaUploadFileState> = {},
  ): boolean {
    const item = items.get(id);
    if (!item) return false;
    if (!TRANSITIONS[item.entry.status].includes(status)) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[cms] upload ${id}: ignored transition ${item.entry.status} -> ${status}`,
        );
      }
      return false;
    }
    item.entry = { ...item.entry, ...change, status };
    if (FINAL.has(status) || status === 'paused') {
      const waiters = item.waiters;
      item.waiters = [];
      for (const resolve of waiters) resolve();
    }
    if (FINAL.has(status) && item.entry.parentId) {
      settleParent(item.entry.parentId);
    }
    update();
    pump();
    return true;
  }

  /**
   * Finishes a parent waiting on its renditions once every child is final.
   * A failed or aborted rendition is a warning on the parent, never an error:
   * the asset exists either way.
   */
  function settleParent(parentId: string) {
    const parent = items.get(parentId);
    if (!parent || parent.entry.status !== 'completing') return;
    const children = parent.children.map((id) => items.get(id)?.entry);
    if (children.some((child) => child && !FINAL.has(child.status))) return;
    const failed = children.filter(
      (child) => child && child.status !== 'success',
    );
    const info = parent.entry.optimize;
    dispatch(parentId, 'success', {
      phase: null,
      loaded: parent.entry.total,
      progress: 1,
      optimize:
        failed.length === 0
          ? info
          : {
              optimized: info?.optimized ?? false,
              bytesBefore: info?.bytesBefore ?? parent.entry.size,
              bytesAfter: info?.bytesAfter ?? parent.entry.size,
              warnings: [
                ...(info?.warnings ?? []),
                ...failed.map((child) => ({
                  code: 'rendition_failed',
                  message: `${child!.variantKey}: ${child!.error?.message ?? child!.status}`,
                })),
              ],
            },
    });
  }

  function setProgress(id: string, loaded: number, total: number) {
    const capped = Math.min(loaded, Math.floor(total * LANDED_PROGRESS));
    if (firstByteAt === null && loaded > 0) firstByteAt = now();
    // Before the patch, so the first sample measures these bytes too.
    ensureSpeedSampling();
    patch(id, {
      loaded: capped,
      total,
      progress: total === 0 ? 0 : capped / total,
    });
  }

  function ensureSpeedSampling() {
    if (speedTimer) return;
    lastSampleBytes = aggregate().loaded;
    speedTimer = setInterval(() => {
      const files = entries();
      if (!files.some((e) => e.status === 'uploading')) {
        clearInterval(speedTimer);
        speedTimer = undefined;
        return;
      }
      const loaded = aggregate().loaded;
      const rate =
        (Math.max(0, loaded - lastSampleBytes) * 1000) / SPEED_SAMPLE_MS;
      lastSampleBytes = loaded;
      speed =
        speed === null ? rate : SPEED_ALPHA * rate + (1 - SPEED_ALPHA) * speed;
      update();
    }, SPEED_SAMPLE_MS);
  }

  // --- budget ---------------------------------------------------------------

  function throttle() {
    budget = Math.max(1, Math.floor(budget / 2));
    lastThrottleAt = now();
    update();
    if (!recoveryTimer) {
      recoveryTimer = setInterval(() => {
        if (now() - lastThrottleAt < BUDGET_RECOVERY_MS) return;
        budget = Math.min(CONNECTION_BUDGET, budget + 1);
        lastThrottleAt = now();
        update();
        pump();
        if (budget === CONNECTION_BUDGET) {
          clearInterval(recoveryTimer);
          recoveryTimer = undefined;
        }
      }, BUDGET_RECOVERY_MS);
    }
  }

  function inFlight(): number {
    let active = 0;
    for (const { entry } of items.values()) {
      if (IN_FLIGHT.has(entry.status)) active++;
    }
    return active;
  }

  // `run` dispatches synchronously, and every dispatch pumps; the flag keeps
  // those nested calls from starting files the outer loop already counts.
  let pumping = false;
  function pump() {
    if (pumping) return;
    pumping = true;
    try {
      const limit = Math.min(MAX_ACTIVE_FILES, budget);
      for (const id of order) {
        if (inFlight() >= limit) break;
        const item = items.get(id)!;
        if (item.entry.status === 'queued') void run(item);
      }
    } finally {
      pumping = false;
    }
  }

  // --- requests -------------------------------------------------------------

  async function request<T>(
    item: Internal,
    send: () => Promise<T>,
    signal: AbortSignal | null,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await withTimeout(send(), REQUEST_TIMEOUT_MS);
      } catch (err) {
        if (signal?.aborted) throw signal.reason;
        const error = errorOf(err);
        if (!error.retryable || attempt + 1 >= UPLOAD_ATTEMPTS) throw err;
        if (
          err instanceof CMSClientError &&
          (err.status === 429 || err.status === 503)
        ) {
          throttle();
        }
        await waitBeforeRetry(item, attempt, undefined, signal);
      }
    }
  }

  async function waitBeforeRetry(
    item: Internal,
    attempt: number,
    retryAfterMs: number | undefined,
    signal: AbortSignal | null,
  ) {
    const delay =
      retryAfterMs === undefined
        ? retryDelay(attempt, {}, options.random)
        : Math.min(retryAfterMs, 30_000);
    const previous = item.entry.status;
    dispatch(item.entry.id, 'retrying', {
      attempt: attempt + 1,
      nextRetryAt: now() + delay,
    });
    await sleep(delay, signal ?? new AbortController().signal);
    if (item.entry.status === 'retrying') {
      item.entry = { ...item.entry, status: previous, nextRetryAt: null };
      update();
    }
  }

  /** A signature for `item`, or `null` for a rendition that already exists. */
  async function sign(
    item: Internal,
    signal: AbortSignal,
  ): Promise<Signed | null> {
    dispatch(item.entry.id, 'signing', { phase: null });
    const { entry } = item;
    if (entry.kind === 'rendition') {
      const res = (await request(
        item,
        () =>
          $fetch('/media/createSignedRendition', {
            method: 'POST',
            body: {
              assetId: entry.targetAssetId,
              variantKey: entry.variantKey,
              size: entry.file.size,
            },
          }),
        signal,
      )) as {
        existing: UploadResult | null;
        upload: (Omit<Signed, 'assetId'> & { id: string }) | null;
      };
      if (res.existing || !res.upload) {
        item.existing = res.existing ?? undefined;
        return null;
      }
      return { ...res.upload, assetId: res.upload.id };
    }
    if (entry.kind === 'replace') {
      const res = (await request(
        item,
        () =>
          $fetch('/media/createSignedReplace', {
            method: 'POST',
            body: {
              assetId: entry.targetAssetId,
              file: {
                name: entry.file.name,
                size: entry.file.size,
                type: entry.file.type,
              },
            },
          }),
        signal,
      )) as Omit<Signed, 'assetId'> & { assetId: string };
      return { ...res, assetId: res.assetId };
    }
    const fileInput: {
      name: string;
      size: number;
      type: string;
      sha256?: string;
    } = {
      name: entry.file.name,
      size: entry.file.size,
      type: entry.file.type,
    };
    if (entry.sha256) fileInput.sha256 = entry.sha256;
    const res = (await request(
      item,
      () =>
        $fetch('/media/createSignedUpload', {
          method: 'POST',
          body: { files: [fileInput], folderId: entry.folderId ?? undefined },
        }),
      signal,
    )) as { uploads: (Omit<Signed, 'assetId'> & { id: string })[] };
    const [upload] = res.uploads;
    return { ...upload, assetId: upload.id };
  }

  // --- resume records -------------------------------------------------------

  /** Records a multipart upload of an unchanged file for a later resume. */
  function remember(item: Internal) {
    const { signed } = item;
    if (
      item.entry.kind !== 'create' ||
      !signed?.multipart ||
      item.entry.file !== item.source ||
      item.renditions.length > 0
    ) {
      return;
    }
    const fingerprint = fingerprintOf(item.source);
    const records = readResumeRecords(resumeStorage, now()).filter(
      (r) => r.fingerprint !== fingerprint,
    );
    records.push({
      fingerprint,
      folderId: item.entry.folderId ?? null,
      signed,
      expiresAt: now() + RESUME_TTL_MS,
    });
    writeResumeRecords(resumeStorage, records);
  }

  function forget(item: Internal) {
    if (item.entry.kind !== 'create') return;
    const fingerprint = fingerprintOf(item.source);
    const records = readResumeRecords(resumeStorage, now());
    const kept = records.filter((r) => r.fingerprint !== fingerprint);
    if (kept.length !== records.length) writeResumeRecords(resumeStorage, kept);
  }

  /** The recorded upload of this file into the same folder, if any. */
  function recalled(item: Internal): Signed | null {
    if (item.entry.kind !== 'create' || item.signed) return null;
    const fingerprint = fingerprintOf(item.source);
    const folderId = item.entry.folderId ?? null;
    return (
      readResumeRecords(resumeStorage, now()).find(
        (r) => r.fingerprint === fingerprint && r.folderId === folderId,
      )?.signed ?? null
    );
  }

  async function put(item: Internal, signal: AbortSignal) {
    const id = item.entry.id;
    let resigned = false;
    for (let attempt = 0; ; attempt++) {
      if (!item.signed) {
        const signed = await sign(item, signal);
        if (!signed) return;
        item.signed = signed;
        if (item.entry.kind === 'create')
          patch(id, { assetId: signed.assetId });
        remember(item);
      }
      if (item.signed.multipart) {
        await putParts(item, item.signed.multipart, signal);
        item.landed = true;
        return;
      }
      dispatch(id, 'uploading', { phase: null });
      try {
        await uploadWithXHR(
          item.signed.signedUrl!,
          item.entry.file,
          item.signed.headers,
          (loaded, total) => {
            setProgress(id, loaded, total);
            if (loaded >= total && item.entry.phase !== 'finalizing') {
              patch(id, { phase: 'finalizing' });
            }
          },
          signal,
        );
        item.landed = true;
        return;
      } catch (err) {
        if (signal.aborted || isAbortError(err)) throw signal.reason ?? err;
        if (!(err instanceof UploadRequestError)) throw err;
        if (err.code === 'UPLOAD_EXPIRED') {
          if (resigned) throw err;
          resigned = true;
          item.signed = null;
          continue;
        }
        if (!err.retryable || attempt + 1 >= UPLOAD_ATTEMPTS) throw err;
        if (err.throttled) throttle();
        setProgress(id, 0, item.entry.total);
        await waitBeforeRetry(item, attempt, err.retryAfterMs, signal);
      }
    }
  }

  /**
   * Uploads the parts a multipart upload does not hold yet. The server's
   * part list is the source of truth: a part it reports with the right
   * length is never uploaded again (some providers drop the old part when
   * a repeated upload fails). Up to `PARTS_PER_FILE` parts run at once,
   * each retried on its own; an upload the storage no longer knows is
   * dropped so a retry starts over.
   */
  async function putParts(
    item: Internal,
    plan: MultipartPlan,
    signal: AbortSignal,
  ) {
    const id = item.entry.id;
    const { file } = item.entry;
    const token = item.signed!.token;
    const lengthOf = (n: number) =>
      Math.min(plan.partSize, file.size - (n - 1) * plan.partSize);

    // A resumed upload arrives from `preparing`, which only moves on to `signing`.
    if (item.entry.status === 'preparing')
      dispatch(id, 'signing', { phase: null });
    dispatch(id, 'uploading', { phase: null });
    const held = new Map<number, number>();
    let marker: number | null = null;
    do {
      const page = (await request(
        item,
        () =>
          $fetch('/media/listUploadParts', {
            method: 'POST',
            body: { token, marker },
          }),
        signal,
      )) as {
        parts: { partNumber: number; size: number }[];
        marker: number | null;
      };
      for (const part of page.parts) held.set(part.partNumber, part.size);
      marker = page.marker;
    } while (marker !== null);

    const missing: number[] = [];
    let doneBytes = 0;
    for (let n = 1; n <= plan.partCount; n++) {
      if (held.get(n) === lengthOf(n)) doneBytes += lengthOf(n);
      else missing.push(n);
    }
    const inFlightBytes = new Map<number, number>();
    const report = () => {
      let loaded = doneBytes;
      for (const bytes of inFlightBytes.values()) loaded += bytes;
      setProgress(id, loaded, file.size);
    };
    report();

    const urls = new Map<number, string>();
    const signParts = async (numbers: number[]) => {
      const res = (await request(
        item,
        () =>
          $fetch('/media/signUploadParts', {
            method: 'POST',
            body: { token, partNumbers: numbers },
          }),
        signal,
      )) as { parts: { partNumber: number; url: string }[] };
      for (const part of res.parts) urls.set(part.partNumber, part.url);
    };

    const queue = [...missing];
    const worker = async () => {
      for (;;) {
        const n = queue.shift();
        if (n === undefined) return;
        if (!urls.has(n))
          await signParts([n, ...queue.slice(0, PARTS_PER_SIGN - 1)]);
        const start = (n - 1) * plan.partSize;
        const body = file.slice(start, start + lengthOf(n));
        let resigned = false;
        for (let attempt = 0; ; attempt++) {
          try {
            await uploadWithXHR(
              urls.get(n)!,
              body,
              {},
              (loaded) => {
                inFlightBytes.set(n, loaded);
                report();
              },
              signal,
            );
            inFlightBytes.delete(n);
            doneBytes += body.size;
            report();
            break;
          } catch (err) {
            inFlightBytes.delete(n);
            report();
            if (signal.aborted || isAbortError(err)) throw signal.reason ?? err;
            if (!(err instanceof UploadRequestError)) throw err;
            if (err.s3Code === 'NoSuchUpload') {
              forget(item);
              item.signed = null;
              throw err;
            }
            if (err.code === 'UPLOAD_EXPIRED' && !resigned) {
              resigned = true;
              await signParts([n]);
              continue;
            }
            if (!err.retryable || attempt + 1 >= UPLOAD_ATTEMPTS) throw err;
            if (err.throttled) throttle();
            await sleep(
              err.retryAfterMs ?? retryDelay(attempt, {}, options.random),
              signal,
            );
          }
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(PARTS_PER_FILE, Math.max(1, missing.length)) },
        worker,
      ),
    );
    if (item.entry.phase !== 'finalizing') patch(id, { phase: 'finalizing' });
  }

  async function complete(item: Internal): Promise<UploadResult> {
    const id = item.entry.id;
    dispatch(id, 'completing', { phase: 'processing' });
    if (item.existing) return item.existing;
    const signed = item.signed!;
    if (item.entry.kind === 'rendition') {
      const res = (await request(
        item,
        () =>
          $fetch('/media/commitRendition', {
            method: 'POST',
            body: { token: signed.token },
          }),
        null,
      )) as { asset: UploadResult };
      return {
        id: res.asset.id,
        slug: res.asset.slug,
        objectKey: res.asset.objectKey,
      };
    }
    if (item.entry.kind === 'replace') {
      const res = (await request(
        item,
        () =>
          $fetch('/media/commitReplace', {
            method: 'POST',
            body: { token: signed.token, revisionNote: item.revisionNote },
          }),
        null,
      )) as { asset: { id: string; slug: string; objectKey: string } };
      return {
        id: res.asset.id,
        slug: res.asset.slug,
        objectKey: res.asset.objectKey,
      };
    }
    const res = (await request(
      item,
      () =>
        $fetch('/media/completeUpload', {
          method: 'POST',
          body: { uploads: [{ token: signed.token, hints: item.hints }] },
        }),
      null,
    )) as {
      assets: { id: string; slug: string; objectKey: string }[];
      errors: { code: string; message: string }[];
    };
    const asset = res.assets.find((a) => a.id === signed.assetId);
    if (!asset) {
      const failure = res.errors[0];
      throw new CMSClientError({
        code: failure?.code ?? 'UPLOAD_FAILED',
        message: failure?.message ?? 'Upload was not completed',
        status: 400,
      });
    }
    return { id: asset.id, slug: asset.slug, objectKey: asset.objectKey };
  }

  /** Deletes the object of a signature that will never be completed. */
  async function abandon(item: Internal) {
    forget(item);
    const token = item.signed?.token;
    item.signed = null;
    item.landed = false;
    if (!token) return;
    try {
      await withTimeout(
        $fetch('/media/abortUpload', { method: 'POST', body: { token } }),
        REQUEST_TIMEOUT_MS,
      );
    } catch {
      // The sweeper removes the object later.
    }
  }

  // --- the run of one entry ---------------------------------------------------

  async function prepare(item: Internal, signal: AbortSignal) {
    const id = item.entry.id;
    const resumed = recalled(item);
    if (resumed) {
      // The recorded upload holds this file's unchanged bytes: no hashing,
      // no optimizer, the parts it holds are kept.
      item.signed = resumed;
      patch(id, { assetId: resumed.assetId });
      return true;
    }
    if (item.dedupe && item.entry.kind === 'create' && !item.entry.sha256) {
      if (item.entry.file.size <= HASH_LIMIT_BYTES) {
        patch(id, { phase: 'hashing' });
        const sha256 = await sha256Base64(item.entry.file);
        if (signal.aborted) throw signal.reason;
        patch(id, { sha256 });
        const res = (await request(
          item,
          () =>
            $fetch('/media/findDuplicates', {
              method: 'POST',
              body: {
                files: [
                  { sha256, name: item.entry.name, size: item.entry.size },
                ],
              },
            }),
          signal,
        )) as {
          results: {
            candidates: {
              assetId: string;
              folderId: string | null;
              matchedBy: string;
            }[];
          }[];
        };
        const exact = (res.results[0]?.candidates ?? []).filter(
          (c) => c.matchedBy === 'sha256',
        );
        if (exact.length > 0) {
          item.pausedBy = 'duplicate';
          dispatch(id, 'paused', {
            phase: null,
            duplicateOf: exact.map(({ assetId, folderId }) => ({
              assetId,
              folderId,
            })),
          });
          return false;
        }
      }
    }
    const optimizer = item.runOptimizer ? options.getOptimizer?.() : undefined;
    if (optimizer?.enabled) {
      patch(id, { phase: 'optimizing' });
      const out = await runOptimizer(optimizer, item.entry.file);
      if (signal.aborted) throw signal.reason;
      item.renditions = out.renditions;
      item.hints = out.hints;
      patch(id, {
        file: out.file,
        name: out.file.name,
        size: out.file.size,
        type: out.file.type,
        total: out.file.size,
        optimize: out.info,
      });
    }
    return true;
  }

  async function run(item: Internal) {
    const id = item.entry.id;
    const controller = new AbortController();
    item.controller = controller;
    const { signal } = controller;
    dispatch(id, 'preparing', {
      error: undefined,
      attempt: 0,
      nextRetryAt: null,
    });
    try {
      if (!(await prepare(item, signal))) return;
      await put(item, signal);
      const result = await complete(item);
      forget(item);
      if (item.renditions.length > 0) {
        // The asset exists; the entry finishes once its renditions did.
        dispatch(id, 'completing', { result, phase: 'renditions' });
        spawnRenditions(item, result.id);
        return;
      }
      dispatch(id, 'success', {
        result,
        loaded: item.entry.total,
        progress: 1,
        phase: null,
        nextRetryAt: null,
      });
    } catch (err) {
      const reason = signal.aborted ? signal.reason : err;
      if (reason instanceof PauseSignal) {
        // A multipart upload keeps its parts; resume uploads the rest.
        if (item.signed?.multipart) {
          dispatch(id, 'paused', { phase: null, nextRetryAt: null });
          return;
        }
        await abandon(item);
        dispatch(id, 'paused', {
          phase: null,
          loaded: 0,
          progress: 0,
          nextRetryAt: null,
        });
      } else if (signal.aborted || isAbortError(err)) {
        await abandon(item);
        dispatch(id, 'aborted', { phase: null, nextRetryAt: null });
      } else {
        const error = errorOf(err);
        // A token or upload the server no longer accepts cannot be resumed.
        if (
          error.code === 'UPLOAD_EXPIRED' ||
          error.code === 'UPLOAD_NOT_FOUND'
        ) {
          forget(item);
        }
        lastError = err;
        dispatch(id, 'error', { error, phase: null, nextRetryAt: null });
      }
    } finally {
      if (item.controller === controller) item.controller = null;
    }
  }

  /** Queues the renditions of `parent` as child entries of asset `assetId`. */
  function spawnRenditions(parent: Internal, assetId: string) {
    const renditions = parent.renditions;
    parent.renditions = [];
    for (const rendition of renditions) {
      const child = create(
        new File([rendition.blob], rendition.variantKey, {
          type: rendition.blob.type,
        }),
        'rendition',
        {
          parentId: parent.entry.id,
          targetAssetId: assetId,
          variantKey: rendition.variantKey,
          folderId: parent.entry.folderId,
          runOptimizer: false,
          dedupe: false,
        },
      );
      parent.children.push(child.entry.id);
    }
    update();
    pump();
  }

  // --- public API ---------------------------------------------------------------

  function create(
    file: File,
    kind: CMSMediaUploadFileState['kind'],
    extra: Partial<CMSMediaUploadFileState> &
      Pick<Internal, 'runOptimizer' | 'dedupe'>,
  ): Internal {
    const { runOptimizer, dedupe, ...fields } = extra;
    const item: Internal = {
      source: file,
      entry: {
        id: `upl_${++entrySequence}`,
        kind,
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'queued',
        phase: null,
        loaded: 0,
        total: file.size,
        progress: 0,
        attempt: 0,
        nextRetryAt: null,
        folderId: null,
        ...fields,
      },
      controller: null,
      pausedBy: null,
      signed: null,
      landed: false,
      runOptimizer,
      dedupe,
      renditions: [],
      children: [],
      waiters: [],
    };
    items.set(item.entry.id, item);
    order.push(item.entry.id);
    return item;
  }

  function settled(item: Internal): Promise<void> {
    if (FINAL.has(item.entry.status) || item.entry.status === 'paused') {
      return Promise.resolve();
    }
    return new Promise((resolve) => item.waiters.push(resolve));
  }

  function bindSignal(created: Internal[], signal: AbortSignal | undefined) {
    if (!signal) return;
    const onAbort = () => {
      for (const item of created) abortOne(item);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  async function upload(
    files: File[],
    uploadOptions: CMSMediaUploadOptions = {},
  ): Promise<CMSMediaUploadFileState[]> {
    if (files.length === 0) return [];
    lastError = null;
    const created = files.map((file) =>
      create(file, 'create', {
        folderId: uploadOptions.folderId ?? null,
        runOptimizer: uploadOptions.optimize !== false,
        dedupe: uploadOptions.dedupe ?? options.dedupe ?? false,
      }),
    );
    update();
    bindSignal(created, uploadOptions.signal);
    pump();
    await Promise.all(created.map(settled));
    flush();
    return created.map((item) => items.get(item.entry.id)!.entry);
  }

  async function replace(
    assetId: string,
    file: File,
    replaceOptions: Parameters<CMSMediaUploadState['replace']>[2] = {},
  ): Promise<CMSMediaUploadFileState> {
    lastError = null;
    const item = create(file, 'replace', {
      targetAssetId: assetId,
      runOptimizer: replaceOptions.optimize !== false,
      dedupe: false,
    });
    item.revisionNote = replaceOptions.revisionNote;
    update();
    bindSignal([item], replaceOptions.signal);
    pump();
    await settled(item);
    flush();
    return items.get(item.entry.id)!.entry;
  }

  // Once the bytes landed the row is created regardless: aborting or pausing
  // then would leave an object the server may already have committed.
  function abortOne(item: Internal) {
    const { status } = item.entry;
    if (FINAL.has(status) || status === 'completing' || item.landed) return;
    if (item.controller) {
      item.controller.abort();
      return;
    }
    void abandon(item);
    dispatch(item.entry.id, 'aborted', { phase: null, nextRetryAt: null });
  }

  function select(id?: string): Internal[] {
    if (id === undefined) return [...items.values()];
    const item = items.get(id);
    return item ? [item] : [];
  }

  function abort(id?: string) {
    for (const item of select(id)) abortOne(item);
  }

  function retry(id?: string) {
    for (const item of select(id)) {
      const { status } = item.entry;
      if (status !== 'error' && !(status === 'aborted' && id !== undefined))
        continue;
      // A failed multipart upload resumes from the parts it holds.
      if (!(status === 'error' && item.signed?.multipart)) item.signed = null;
      item.landed = false;
      dispatch(item.entry.id, 'queued', {
        error: undefined,
        attempt: 0,
        loaded: 0,
        progress: 0,
        nextRetryAt: null,
      });
    }
  }

  function pauseOne(item: Internal, reason: PauseReason) {
    if (
      !ACTIVE.has(item.entry.status) ||
      item.entry.status === 'completing' ||
      item.landed
    ) {
      return;
    }
    item.pausedBy = reason;
    if (item.controller) {
      item.controller.abort(new PauseSignal());
    } else {
      dispatch(item.entry.id, 'paused');
    }
  }

  function pause(id?: string) {
    for (const item of select(id)) pauseOne(item, 'user');
  }

  function resumeWhere(match: (item: Internal) => boolean) {
    for (const item of items.values()) {
      if (item.entry.status !== 'paused' || !match(item)) continue;
      if (item.pausedBy === 'duplicate') continue;
      item.pausedBy = null;
      dispatch(item.entry.id, 'queued', { attempt: 0, nextRetryAt: null });
    }
  }

  function resume(id?: string) {
    resumeWhere((item) => id === undefined || item.entry.id === id);
  }

  function resolveDuplicate(id: string, decision: CMSMediaDuplicateDecision) {
    const item = items.get(id);
    if (!item || item.pausedBy !== 'duplicate') return;
    item.pausedBy = null;
    if (decision.action === 'use-existing') {
      dispatch(id, 'success', {
        result: { id: decision.assetId, slug: '', objectKey: '' },
        progress: 1,
        loaded: item.entry.total,
        duplicateOf: undefined,
      });
      return;
    }
    if (decision.action === 'replace') {
      item.entry = {
        ...item.entry,
        kind: 'replace',
        targetAssetId: decision.assetId,
      };
    }
    item.dedupe = false;
    dispatch(id, 'queued', { duplicateOf: undefined });
  }

  async function regenerateRenditions(
    assetId: string,
  ): Promise<CMSMediaUploadFileState[]> {
    const optimizer = options.getOptimizer?.();
    if (!optimizer?.enabled) return [];
    const { assets: found } = (await $fetch('/media/getAssets', {
      method: 'GET',
      query: { ids: [assetId] },
    })) as {
      assets: {
        id: string;
        slug: string;
        originalName?: string | null;
        mimeType: string;
        deliveryUrl: string;
        folderId: string | null;
      }[];
    };
    const asset = found.find((a) => a.id === assetId);
    if (!asset) return [];
    const fetchBlob =
      options.fetchBlob ??
      (async (url: string) => {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok)
          throw new Error(`Could not download ${url}: ${res.status}`);
        return res.blob();
      });
    const original = new File(
      [await fetchBlob(asset.deliveryUrl)],
      asset.originalName ?? asset.slug,
      { type: asset.mimeType },
    );
    const { renditions } = await runOptimizer(optimizer, original);
    const created = renditions.map((rendition) =>
      create(
        new File([rendition.blob], rendition.variantKey, {
          type: rendition.blob.type,
        }),
        'rendition',
        {
          targetAssetId: assetId,
          variantKey: rendition.variantKey,
          folderId: asset.folderId,
          runOptimizer: false,
          dedupe: false,
        },
      ),
    );
    update();
    pump();
    await Promise.all(created.map(settled));
    flush();
    return created.map((item) => items.get(item.entry.id)!.entry);
  }

  function reset() {
    const kept = order.filter((id) => !FINAL.has(items.get(id)!.entry.status));
    for (const id of order) {
      if (!kept.includes(id)) items.delete(id);
    }
    order.splice(0, order.length, ...kept);
    lastError = null;
    flush();
  }

  // --- browser lifecycle ----------------------------------------------------------

  const watchBrowser =
    options.browserEvents ??
    (typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function');
  let unloadGuard = false;
  const onBeforeUnload = (event: Event) => {
    event.preventDefault();
  };

  /**
   * `beforeunload` is registered only while bytes are moving or a row is
   * being created: a listener makes the page ineligible for the bfcache.
   */
  function syncBrowserGuards(files: CMSMediaUploadFileState[]) {
    if (!watchBrowser) return;
    const busy = files.some(
      (e) => e.status === 'uploading' || e.status === 'completing',
    );
    if (busy && !unloadGuard) {
      window.addEventListener('beforeunload', onBeforeUnload);
      unloadGuard = true;
    } else if (!busy && unloadGuard) {
      window.removeEventListener('beforeunload', onBeforeUnload);
      unloadGuard = false;
    }
  }

  if (watchBrowser) {
    window.addEventListener('offline', () => {
      for (const item of items.values()) pauseOne(item, 'offline');
    });
    window.addEventListener('online', () => {
      resumeWhere((item) => item.pausedBy === 'offline');
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        const pending = [...items.values()]
          .filter(
            ({ entry }) =>
              entry.kind !== 'rendition' &&
              (ACTIVE.has(entry.status) || entry.status === 'paused'),
          )
          .map((item) => ({
            name: item.source.name,
            size: item.source.size,
            kind: item.entry.kind,
            resumable: recalled({ ...item, signed: null }) !== null,
          }));
        try {
          if (pending.length > 0) {
            sessionStorage.setItem(
              PENDING_STORAGE_KEY,
              JSON.stringify(pending),
            );
          } else {
            sessionStorage.removeItem(PENDING_STORAGE_KEY);
          }
        } catch {
          // Storage can be unavailable (private mode, quota); nothing to keep.
        }
      });
    }
  }

  store.set({
    ...store.get(),
    upload,
    replace,
    abort,
    retry,
    pause,
    resume,
    resolveDuplicate,
    regenerateRenditions,
    reset,
  });
  return store;
}

/**
 * Uploads that were unfinished when the page was last hidden (name, size,
 * kind), so an app can ask the user to pick them again after a reload.
 * `resumable` marks a multipart upload that continues where it stopped
 * when the same file (name, size, modification time) is uploaded into the
 * same folder within 24 hours. Reading clears the list, not the resume
 * records.
 */
export function takeInterruptedUploads(): {
  name: string;
  size: number;
  kind: 'create' | 'replace';
  resumable: boolean;
}[] {
  try {
    const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
    sessionStorage.removeItem(PENDING_STORAGE_KEY);
    return raw
      ? (
          JSON.parse(raw) as (Omit<
            ReturnType<typeof takeInterruptedUploads>[number],
            'resumable'
          > & { resumable?: boolean })[]
        ).map((upload) => ({ ...upload, resumable: upload.resumable ?? false }))
      : [];
  } catch {
    return [];
  }
}
