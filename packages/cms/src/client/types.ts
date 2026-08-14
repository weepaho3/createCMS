import type { ReadableAtom, WritableAtom } from 'nanostores';

import type { ServerOnlyEndpoint } from '../core/types/definitions';

import type { CMS_ERRORS } from '../core/errors-data';

// ============================================================================
// Fetch
// ============================================================================

export type CMSFetch = (
  path: string,
  options?: {
    method?: string;
    body?: unknown;
    query?: unknown;
    /**
     * Forwarded to the underlying `fetch` (better-call → @better-fetch → native
     * `fetch`). Set for fire-and-forget analytics beacons (the A/B event ingest)
     * so the POST is NOT cancelled when the page unloads/navigates mid-request.
     */
    keepalive?: boolean;
  },
) => Promise<unknown>;

// ============================================================================
// Atom Listener (signal-based cache invalidation)
// ============================================================================

export type CMSAtomListener = {
  matcher: (path: string) => boolean;
  signal: string;
  callback?: (path: string) => void;
};

// ============================================================================
// Client Store
// ============================================================================

export interface CMSClientStore {
  invalidate: (signal: string) => void;
  /** Subscribe to a signal; returns an unsubscribe (react-10). */
  listen: (signal: string, listener: () => void) => () => void;
  atoms: Record<string, WritableAtom<unknown>>;
}

// ============================================================================
// Client Plugin
// ============================================================================

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

// ============================================================================
// Media Upload State
// ============================================================================

export type CMSMediaUploadFileState = {
  name: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  optimized?: boolean;
  originalVariantId?: string;
  result?: { id: string; slug: string; objectKey: string };
};

export type CMSMediaUploadOptions = {
  folderId?: string;
};

export type CMSMediaUploadState = {
  isUploading: boolean;
  isAborted: boolean;
  files: CMSMediaUploadFileState[];
  totalProgress: number;
  error: unknown;
  upload: (files: File[], options?: CMSMediaUploadOptions) => Promise<void>;
  abort: () => void;
  reset: () => void;
};

// ============================================================================
// Query Atom State
// ============================================================================

export type CMSQueryState<T = unknown> = {
  data: T | null;
  error: unknown;
  isPending: boolean;
  isRefetching: boolean;
  refetch: () => Promise<void>;
};

// ============================================================================
// Client Options
// ============================================================================

export interface CMSClientOptions {
  baseURL: string;
  plugins?: CMSClientPlugin[];
  /**
   * Runtime map of `path → HTTP method` used by the proxy to dispatch RPC
   * calls (e.g. `/notifications/markNotificationsRead → 'POST'`). Seed this
   * with the server's `cms.$pathMethods` so optional-body POST endpoints are
   * not mis-inferred as GET. Plugin `pathMethods` are merged on top.
   */
  pathMethods?: Record<string, 'GET' | 'POST'>;
}

// ============================================================================
// Type Inference Utilities
// ============================================================================

/**
 * Maps a SERVER return type to its over-the-wire (JSON) shape as seen by the
 * HTTP client: a `Date` becomes the ISO `string` that `JSON.parse` actually
 * yields. (Server-side `cms.api.*` calls return real `Date`s and are unaffected;
 * this only rewrites the client's typed surface, so `client.pages.getRoot()`'s
 * `createdAt` is typed `string` — call `new Date(...)` to revive it.)
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

// Apply `Serialize` to every endpoint method's RESOLVED return, leaving the
// input `opts` exactly as the server declares them. The `as ... ? never : M`
// remap ALSO drops any key whose caller carries the `ServerOnlyEndpoint` brand
// (see core/types/definitions.ts) — an endpoint marked `scope: 'server'`
// (e.g. media.uploadAssets / media.replaceAsset) never appears on the client's
// type surface, even though `cms.api.*` (server.ts's own caller type,
// untouched by this file) keeps it. Plan 008.
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
    // api-16: recognized core codes plus any plugin-contributed codes.
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
