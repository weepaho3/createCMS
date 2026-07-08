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
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    let event: RevalidateEvent;
    try {
      event = (await request.json()) as RevalidateEvent;
    } catch {
      return Response.json({ message: 'Invalid JSON body' }, { status: 400 });
    }
    const paths = event.paths ?? [];
    const tags = event.tags ?? [];

    if (paths.length > 0 || tags.length > 0) {
      // Runtime dynamic import: next/cache is only resolvable when next is
      // installed as a peer dependency, so it must not be resolved at build
      // time. bunchee externalizes next (a peer dep) and preserves this import.
      const { revalidatePath, revalidateTag } = await import('next/cache');
      for (const path of paths) {
        revalidatePath(path);
      }
      // Tags invalidate a root's control + all its variant-coded cache entries
      // (AB_FANOUT FA3b); the A/B render routes tag their fetch by rootRevalidateTag.
      // 'max' is next 16's required second arg (equivalent to the legacy single-
      // arg immediate invalidation; the tag is marked stale regardless of profile).
      for (const tag of tags) {
        revalidateTag(tag, 'max');
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
