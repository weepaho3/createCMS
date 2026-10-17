import type { ReadableAtom, WritableAtom } from 'nanostores';

import type { ServerOnlyEndpoint } from '../core/types/definitions';
import type { CMS_ERRORS } from '../errors-data';

export type CMSFetch = (
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    query?: unknown;
    /**
     * Forwarded to the underlying `fetch` (better-call -> @better-fetch ->
     * native `fetch`). Set for fire-and-forget analytics beacons (the A/B
     * event ingest) so the POST survives page unload/navigation.
     */
    keepalive?: boolean;
  },
) => Promise<unknown>;

export type CMSAtomListener = {
  matcher: (path: string) => boolean;
  signal: string;
  callback?: (path: string) => void;
};

export interface CMSClientStore {
  invalidate: (signal: string) => void;
  /** Subscribe to a signal; returns an unsubscribe function. */
  listen: (signal: string, listener: () => void) => () => void;
  atoms: Record<string, WritableAtom<unknown>>;
}

export interface CMSClientPlugin {
  id: string;
  init?: (
    $fetch: CMSFetch,
    $store: CMSClientStore,
  ) => Promise<{ context?: Record<string, unknown> } | void>;
  getActions?: (
    $fetch: CMSFetch,
    $store: CMSClientStore,
    baseURL: string,
  ) => Record<string, unknown>;
  pathMethods?: Record<string, 'GET' | 'POST'>;
  atomListeners?: CMSAtomListener[];
  $ERROR_CODES?: Record<string, { status: number; message: string }>;
}

/**
 * Where an upload stands. Active: `queued`, `preparing`, `signing`,
 * `uploading`, `completing`, `retrying`. Waiting: `paused` (offline, by
 * request, or a duplicate awaiting a decision). Final: `success`, `error`,
 * `aborted`; `error` returns to `queued` through `retry`.
 */
export type CMSMediaUploadStatus =
  | 'queued'
  | 'preparing'
  | 'signing'
  | 'uploading'
  | 'completing'
  | 'success'
  | 'paused'
  | 'retrying'
  | 'error'
  | 'aborted';

/**
 * Detail within a status: `hashing`/`optimizing` while `preparing`,
 * `finalizing` once every byte is sent but the PUT has not answered,
 * `processing` while `completing`.
 */
export type CMSMediaUploadPhase =
  | 'hashing'
  | 'optimizing'
  | 'finalizing'
  | 'processing'
  | null;

export type CMSMediaUploadFileState = {
  /** Stable per-entry id, unique for the queue's lifetime. */
  id: string;
  /** `create` uploads a new asset; `replace` swaps the bytes of `targetAssetId`. */
  kind: 'create' | 'replace';
  file: File;
  name: string;
  size: number;
  type: string;
  status: CMSMediaUploadStatus;
  phase: CMSMediaUploadPhase;
  loaded: number;
  total: number;
  /** 0..1; at most 0.99 until `success`. */
  progress: number;
  /** Attempts of the current step, 0 before the first retry. */
  attempt: number;
  /** When a `retrying` entry tries again (epoch ms). */
  nextRetryAt: number | null;
  folderId: string | null;
  /** The asset a `replace` entry swaps. */
  targetAssetId?: string;
  /** Base64 SHA-256 of the bytes, once hashed. */
  sha256?: string;
  /** Existing assets with the same bytes; the entry waits `paused` for `resolveDuplicate`. */
  duplicateOf?: { assetId: string; folderId: string | null }[];
  error?: {
    code: string;
    message: string;
    retryable: boolean;
    timedOut?: boolean;
  };
  /** Outcome of the media-optimize plugin, when it processed this file. */
  optimize?: CMSMediaUploadOptimizeInfo;
  result?: { id: string; slug: string; objectKey: string };
};

/**
 * What the media-optimize plugin did to a file before upload. `optimized` is
 * false when the input was uploaded unchanged; `warnings` then says why.
 */
export type CMSMediaUploadOptimizeInfo = {
  optimized: boolean;
  bytesBefore: number;
  bytesAfter: number;
  warnings: { code: string; message: string }[];
};

export type CMSMediaUploadProgress = {
  loaded: number;
  total: number;
  fraction: number;
  /** Smoothed transfer rate; `null` until measured. */
  bytesPerSecond: number | null;
  /** Seconds left for every unfinished file; `null` in the first seconds or while stalled. */
  eta: number | null;
};

export type CMSMediaUploadOptions = {
  folderId?: string;
  /** Aborts this call's entries (each still completes once its PUT landed). */
  signal?: AbortSignal;
  /** `false` skips the optimizing hooks (the media-optimize plugin). */
  optimize?: boolean;
  /**
   * Hash each file (up to 64 MiB) and look for assets with the same bytes;
   * a match waits `paused` with `duplicateOf` for `resolveDuplicate`.
   * Default `false`.
   */
  dedupe?: boolean;
};

/** How to settle an entry that waits on a duplicate. */
export type CMSMediaDuplicateDecision =
  /** Finish with the existing asset; nothing is uploaded. */
  | { action: 'use-existing'; assetId: string }
  /** Upload anyway as a new asset. */
  | { action: 'upload-copy' }
  /** Upload as new bytes of the existing asset. */
  | { action: 'replace'; assetId: string };

export type CMSMediaUploadState = {
  /** True while any entry is active. */
  isUploading: boolean;
  files: CMSMediaUploadFileState[];
  progress: CMSMediaUploadProgress;
  error: unknown;
  /** Connections the queue may use now (6, halved while throttled). */
  budget: number;
  /** Queues `files` as new assets; resolves with these entries once each settles or pauses. */
  upload: (
    files: File[],
    options?: CMSMediaUploadOptions,
  ) => Promise<CMSMediaUploadFileState[]>;
  /** Queues new bytes for an existing asset; resolves with the entry. */
  replace: (
    assetId: string,
    file: File,
    options?: Pick<CMSMediaUploadOptions, 'signal' | 'optimize'> & {
      revisionNote?: string;
    },
  ) => Promise<CMSMediaUploadFileState>;
  /** Aborts one entry, or every unfinished entry without an id. A landed object is deleted. */
  abort: (id?: string) => void;
  /** Re-queues a failed (or aborted) entry, or every failed entry without an id, with a fresh signature. */
  retry: (id?: string) => void;
  /** Pauses one entry, or all; a running PUT restarts on resume. */
  pause: (id?: string) => void;
  resume: (id?: string) => void;
  /** Settles an entry waiting on a duplicate. */
  resolveDuplicate: (id: string, decision: CMSMediaDuplicateDecision) => void;
  /** Drops finished entries (success, error, aborted) and clears `error`. */
  reset: () => void;
};

export type CMSQueryState<T = unknown> = {
  data: T | null;
  error: unknown;
  isPending: boolean;
  isRefetching: boolean;
  refetch: () => Promise<void>;
};

export interface CMSClientOptions {
  baseURL: string;
  plugins?: CMSClientPlugin[];
  /**
   * Runtime map of `path -> HTTP method` used by the proxy to dispatch RPC
   * calls (e.g. `/notifications/markNotificationsRead -> 'POST'`). Seed this
   * with the server's `cms.$pathMethods` so optional-body POST endpoints are
   * not mis-inferred as GET. Plugin `pathMethods` are merged on top.
   */
  pathMethods?: Record<string, 'GET' | 'POST'>;
}

/**
 * Maps a server return type to its over-the-wire (JSON) shape as seen by the
 * HTTP client: a `Date` becomes the ISO `string` that `JSON.parse` actually
 * yields. Server-side `cms.api.*` calls return real `Date`s and are
 * unaffected; on the client, revive with `new Date(...)`.
 */
export type Serialize<T> = T extends Date
  ? string
  : // eslint-disable-next-line @typescript-eslint/no-explicit-any
    T extends (...args: any[]) => any
    ? T
    : T extends Array<infer U>
      ? Serialize<U>[]
      : T extends ReadonlyArray<infer U>
        ? ReadonlyArray<Serialize<U>>
        : T extends object
          ? { [K in keyof T]: Serialize<T[K]> }
          : T;

// Applies `Serialize` to every endpoint method's resolved return, leaving the
// input `opts` exactly as the server declares them. The `as ... ? never : M`
// remap also drops any key whose caller carries the `ServerOnlyEndpoint`
// brand (see core/types/definitions.ts): an endpoint marked
// `scope: 'server'` (e.g. media.uploadAssets / media.replaceAsset) never
// appears on the client's type surface, while `cms.api.*` keeps it.
type SerializeApi<A> = {
  [NS in keyof A]: {
    [M in keyof A[NS] as A[NS][M] extends ServerOnlyEndpoint
      ? never
      : M]: A[NS][M] extends (...args: infer Args) => infer R
      ? (
          ...args: Args
        ) => R extends Promise<infer RR> ? Promise<Serialize<RR>> : Serialize<R>
      : A[NS][M];
  };
};

type InferApi<T> = T extends { api: infer A } ? SerializeApi<A> : {};

type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

type InferPluginActions<P extends CMSClientPlugin[]> = UnionToIntersection<
  {
    [K in keyof P]: P[K] extends CMSClientPlugin
      ? ReturnType<NonNullable<P[K]['getActions']>> extends infer A
        ? A extends Record<string, unknown>
          ? A
          : {}
        : {}
      : {};
  }[number]
>;

type InferClientPluginErrorCodes<P extends CMSClientPlugin[]> =
  UnionToIntersection<
    P[number] extends infer Plug
      ? Plug extends CMSClientPlugin
        ? Plug['$ERROR_CODES'] extends Record<string, any>
          ? Plug['$ERROR_CODES']
          : {}
        : {}
      : {}
  >;

// React entrypoint: `media.useUploadAssets` is a hook thunk.
type WithMedia<T> = T extends { media: infer M }
  ? Omit<T, 'media'> & {
      media: M & { useUploadAssets: () => CMSMediaUploadState };
    }
  : T & { media: { useUploadAssets: () => CMSMediaUploadState } };

// Vanilla entrypoint: `media.uploadState` is the raw nanostores atom
// (consumers call `.get()` / `.subscribe()` themselves).
type WithMediaAtom<T> = T extends { media: infer M }
  ? Omit<T, 'media'> & {
      media: M & { uploadState: ReadableAtom<CMSMediaUploadState> };
    }
  : T & { media: { uploadState: ReadableAtom<CMSMediaUploadState> } };

type CMSClientBase<TPlugins extends CMSClientPlugin[]> =
  InferPluginActions<TPlugins> & {
    $fetch: CMSFetch;
    $store: CMSClientStore;
    $ERROR_CODES: typeof CMS_ERRORS & InferClientPluginErrorCodes<TPlugins>;
  };

export type CMSClientInstance<
  TCMS = unknown,
  TPlugins extends CMSClientPlugin[] = CMSClientPlugin[],
> = WithMedia<InferApi<TCMS>> & CMSClientBase<TPlugins>;

export type CMSVanillaClientInstance<
  TCMS = unknown,
  TPlugins extends CMSClientPlugin[] = CMSClientPlugin[],
> = WithMediaAtom<InferApi<TCMS>> & CMSClientBase<TPlugins>;
