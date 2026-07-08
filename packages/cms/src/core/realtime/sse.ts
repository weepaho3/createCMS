import type { CMSMiddleware, CMSProcedureContext } from '../types/definitions';
import { defaultAuthorizeChannels } from './channels';
import type { RealtimeRuntime } from './types';

/** Channel-authorization policy: maps an authenticated (or anonymous) caller +
 *  requested channels to a rejecting `Response`, or void to allow. */
export type AuthorizeChannelsPolicy = (
  userId: string | undefined,
  channels: string[],
) => Response | void;

export type RealtimeRouteOptions = {
  transport: RealtimeRuntime;
  /**
   * The exact pathname this route serves (e.g. `/api/cms/realtime`). Matched
   * exactly — NOT by suffix — so it never swallows a sibling that merely ends in
   * `/realtime` (e.g. the A/B plugin's legacy `/abTest/realtime`).
   */
  path: string;
  /** Procedure ctx used to invoke the auth middleware (db/collections/…). */
  cmsCtx: CMSProcedureContext;
  /** The resolved auth middleware (authMiddleware ?? middleware), or undefined. */
  authMiddleware: CMSMiddleware | undefined;
  /** Override the default per-user channel-authorization policy. */
  authorizeChannels?: AuthorizeChannelsPolicy;
};

/**
 * Builds the `/realtime` SSE request handler for the router `onRequest` seam.
 *
 * Authentication closes the gap that the `onRequest` path otherwise bypasses:
 * each connection is authenticated via the SAME auth middleware (it reads the
 * session from request cookies — EventSource cannot send Authorization headers),
 * then every requested channel is authorized against that identity. Returns
 * `undefined` for non-realtime paths (fall through) and when the subscribe peer
 * is unavailable.
 */
export function createRealtimeRouteHandler(options: RealtimeRouteOptions) {
  const policy = options.authorizeChannels ?? defaultAuthorizeChannels;
  let handlerPromise: Promise<
    ((request: Request) => Promise<Response | void>) | null
  > | null = null;

  function ensureHandler() {
    if (!handlerPromise) {
      handlerPromise = options.transport.getSseHandler(
        async (request, channels) => {
          const userId = await resolveRealtimeUserId(
            options.authMiddleware,
            options.cmsCtx,
            request,
          );
          return policy(userId, channels);
        },
      );
    }
    return handlerPromise;
  }

  return async function handleRealtimeRequest(
    request: Request,
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname !== options.path) return undefined;
    const handler = await ensureHandler();
    if (!handler) return undefined; // subscribe peer unavailable — fall through
    const response = await handler(request);
    return response ?? undefined;
  };
}

/**
 * Resolves the caller's user id via the auth middleware, modelled as a
 * system-scoped read on the synthetic `realtime` resource (mirrors how the
 * endpoint wrapper builds the middleware ctx). Any failure resolves to
 * `undefined` so the channel policy fails closed for private channels.
 */
async function resolveRealtimeUserId(
  authMiddleware: CMSMiddleware | undefined,
  cmsCtx: CMSProcedureContext,
  request: Request,
): Promise<string | undefined> {
  if (!authMiddleware) return undefined;
  try {
    const result = await authMiddleware({
      ...cmsCtx,
      scope: 'system',
      permissionResource: 'realtime',
      operation: 'read',
      request: { request, headers: request.headers },
    });
    return result?.userId;
  } catch {
    return undefined;
  }
}
