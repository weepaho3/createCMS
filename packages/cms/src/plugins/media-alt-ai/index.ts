import { and, eq, isNull } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSPlugin } from '../../core/types/plugin';
import type { MediaConfig } from '../../core/types/s3';
import type { AltContext } from './prompt';

import { assets } from '../../core/db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../../core/endpoint';
import { CMSError } from '../../core/errors';
import { createRateWindow } from '../../core/media/rate-window';
import { getStorage } from '../../core/storage/get-storage';
import { altPrompt, cleanAltSuggestion } from './prompt';

export type { AltContext } from './prompt';
export { ALT_MAX_LENGTH, altPrompt, cleanAltSuggestion } from './prompt';

const PLUGIN_ID = 'mediaAltAi' as const;

/** What `describe` gets: the image bytes and the prompt built from the context. */
export type AltDescribeInput = {
  image: { bytes: Uint8Array; mimeType: string };
  prompt: string;
  context: AltContext;
  assetId: string;
};

export type MediaAltAiConfig = {
  /**
   * Calls a vision model of your choice and returns its answer (cleaned
   * with `cleanAltSuggestion`), or `null`. Errors answer `null` too.
   */
  describe: (input: AltDescribeInput) => Promise<string | null>;
  /** Suggestions one actor may ask for per minute, counted per process. @default 20 */
  rateLimit?: number;
  /** Larger originals are described from a stored rendition up to this size, or not at all. @default 5 MiB */
  maxImageBytes?: number;
};

const DESCRIBABLE = /^image\/(jpeg|png|webp|gif|avif)$/;

/**
 * The server side of AI alt text: `mediaAltAi.suggestAlt({ assetId,
 * context })` describes an image of the caller's scope with your vision
 * model. It only suggests: nothing is written, the editor copies an
 * accepted suggestion into the block's alt text as `ai-suggested`.
 */
export function mediaAltAi(config: MediaAltAiConfig) {
  let media: MediaConfig | undefined;
  const rateWindow = createRateWindow();
  const limit = config.rateLimit ?? 20;
  const maxBytes = config.maxImageBytes ?? 5 * 1024 * 1024;

  const endpoints = {
    /**
     * Suggests alt text for an image asset in the caller's scope, with the
     * block context of its use. Writes nothing.
     *
     * @param assetId - A live, ready image asset.
     * @param context - Field type, surrounding text, page title, locale and link target of the use.
     * @returns `{ alt }`, the suggestion or `null` when the model had none.
     * @throws ASSET_NOT_FOUND outside the caller's scope or for a non-image.
     * @throws RATE_LIMITED (429) when the actor asked too often in the last minute.
     */
    suggestAlt: createCMSEndpoint(
      `/${PLUGIN_ID}/suggestAlt`,
      {
        method: 'POST',
        body: z.object({
          assetId: z.string(),
          context: z
            .object({
              fieldType: z.string().max(100).optional(),
              surroundingText: z.string().max(5000).optional(),
              pageTitle: z.string().max(500).optional(),
              locale: z.string().max(35).optional(),
              linkTarget: z.string().max(2048).optional(),
            })
            .default({}),
        }),
        metadata: cmsMeta(
          {},
          {
            operation: 'read',
            scope: 'system',
            permissionResource: 'media',
          },
        ),
      },
      async (ctx) => {
        if (!media) throw new CMSError('STORAGE_UNSUPPORTED');
        const { db, scope, userId } = ctx.context;
        const { assetId, context } = ctx.body;
        const wait = rateWindow(userId ?? 'anonymous', 1, limit);
        if (wait > 0) {
          throw new CMSError('RATE_LIMITED', {
            headers: { 'retry-after': String(wait) },
            data: { retryAfter: wait },
          });
        }
        const conditions = [
          eq(assets.id, assetId),
          isNull(assets.archivedAt),
          eq(assets.processingState, 'ready'),
        ];
        if (scope.assets?.where) conditions.push(scope.assets.where);
        const [asset] = await db
          .select({
            id: assets.id,
            objectKey: assets.objectKey,
            mimeType: assets.mimeType,
            size: assets.size,
          })
          .from(assets)
          .where(and(...conditions));
        if (!asset || !DESCRIBABLE.test(asset.mimeType)) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: `No image asset ${assetId} in scope`,
          });
        }

        let source: { objectKey: string; mimeType: string } | null =
          asset.size <= maxBytes ? asset : null;
        if (!source) {
          // The smallest stored rendition that fits describes as well.
          const renditions = await db
            .select({
              objectKey: assets.objectKey,
              mimeType: assets.mimeType,
              size: assets.size,
            })
            .from(assets)
            .where(
              and(
                eq(assets.variantOf, asset.id),
                isNull(assets.archivedAt),
                eq(assets.processingState, 'ready'),
              ),
            );
          source =
            renditions
              .filter((r) => r.size <= maxBytes && DESCRIBABLE.test(r.mimeType))
              .sort((a, b) => b.size - a.size)[0] ?? null;
        }
        if (!source) return { alt: null };

        const bytes = await getStorage(media).getRange(
          source.objectKey,
          0,
          maxBytes - 1,
        );
        if (!bytes) return { alt: null };
        try {
          const text = await config.describe({
            image: { bytes, mimeType: source.mimeType },
            prompt: altPrompt(context),
            context,
            assetId: asset.id,
          });
          return { alt: cleanAltSuggestion(text) };
        } catch (err) {
          console.error('[cms] mediaAltAi describe failed:', err);
          return { alt: null };
        }
      },
    ),
  };

  return {
    id: PLUGIN_ID,
    endpoints,
    init(ctx) {
      media = ctx.media;
    },
  } satisfies CMSPlugin;
}
