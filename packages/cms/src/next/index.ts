import { timingSafeEqual } from 'crypto';

import type { RevalidateEvent } from '../core/types/definitions';

export type CreateRevalidateHandlerOptions = {
  secret: string;
};

function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Creates a Next.js API route handler for receiving CMS revalidation
 * webhook events. Validates the shared secret using a constant-time
 * comparison, then calls `revalidatePath` for each path in the event.
 *
 * @example
 * ```ts
 * // app/api/cms/revalidate/route.ts
 * import { createRevalidateHandler } from '@createcms/core/next';
 *
 * export const POST = createRevalidateHandler({
 *   secret: process.env.REVALIDATION_SECRET!,
 * });
 * ```
 */
export function createRevalidateHandler(
  options: CreateRevalidateHandlerOptions,
) {
  return async (request: Request): Promise<Response> => {
    const secret = request.headers.get('x-revalidate-secret');
    if (!secret || !constantTimeEqual(secret, options.secret)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const event: RevalidateEvent = await request.json();
    const paths = event.paths ?? [];
    const tags = event.tags ?? [];

    if (paths.length > 0 || tags.length > 0) {
      // Dynamic import avoids compile-time resolution of next/cache
      // which is only available when next is installed as a peer dependency.
      const nextCache = await (Function(
        'return import("next/cache")',
      )() as Promise<{
        revalidatePath: (path: string) => void;
        revalidateTag: (tag: string) => void;
      }>);
      for (const path of paths) {
        nextCache.revalidatePath(path);
      }
      // Tags invalidate a root's control + all its variant-coded cache entries
      // (AB_FANOUT FA3b); the A/B render routes tag their fetch by rootRevalidateTag.
      for (const tag of tags) {
        nextCache.revalidateTag(tag);
      }
    }

    return Response.json({
      revalidated: true,
      paths,
      tags,
    });
  };
}

export type { RevalidateEvent };
