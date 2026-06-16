import type { WritableAtom } from 'nanostores';

import type { CMSPlugin } from '../core/types/plugin';

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
  notify: (signal: string) => void;
  listen: (signal: string, listener: () => void) => void;
  atoms: Record<string, WritableAtom<unknown>>;
}

// ============================================================================
// Client Plugin
// ============================================================================

export interface CMSClientPlugin {
  id: string;
  $InferServerPlugin?: CMSPlugin;
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

export type MediaUploadFileState = {
  name: string;
  progress: number;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
  optimized?: boolean;
  originalVariantId?: string;
  result?: { id: string; slug: string; objectKey: string };
};

export type MediaUploadOptions = {
  folderId?: string;
};

export type MediaUploadState = {
  isUploading: boolean;
  isAborted: boolean;
  files: MediaUploadFileState[];
  totalProgress: number;
  error: unknown;
  upload: (files: File[], options?: MediaUploadOptions) => Promise<void>;
  abort: () => void;
  reset: () => void;
};

// ============================================================================
// Query Atom State
// ============================================================================

export type QueryState<T = unknown> = {
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
}

// ============================================================================
// Type Inference Utilities
// ============================================================================

type InferApi<T> = T extends { api: infer A } ? A : {};

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

type WithMedia<T> = T extends { media: infer M }
  ? Omit<T, 'media'> & {
      media: M & { useUploadAssets: () => MediaUploadState };
    }
  : T & { media: { useUploadAssets: () => MediaUploadState } };

export type CMSClientInstance<
  TCMS = unknown,
  TPlugins extends CMSClientPlugin[] = CMSClientPlugin[],
> = WithMedia<InferApi<TCMS>> &
  InferPluginActions<TPlugins> & {
    $fetch: CMSFetch;
    $store: CMSClientStore;
    $ERROR_CODES: InferClientPluginErrorCodes<TPlugins>;
  };
