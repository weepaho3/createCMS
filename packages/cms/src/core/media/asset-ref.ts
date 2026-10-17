import type {
  AssetRef,
  ImageValue,
  RichTextImageAttrs,
  RichTextLinkAttrs,
} from '@createcms/schema';

import * as z from 'zod';

// Asset ids are nanoids like `ast_<20 chars>`.
const ASSET_ID = /^[a-z]{2,5}_[0-9a-z]{20}$/;

/** `value` as an `AssetRef`; a bare id becomes `{ assetId }`. */
export function normalizeAssetRef(value: ImageValue): AssetRef {
  return typeof value === 'string' ? { assetId: value } : value;
}

/** The asset id of an `image` value. */
export function assetIdOf(value: ImageValue): string {
  return typeof value === 'string' ? value : value.assetId;
}

/**
 * The `alt` attribute to render for an image use: `""` when decorative, the
 * alt text when set, otherwise `undefined` (never the file name).
 */
export function imageAlt(
  value: Pick<AssetRef, 'alt' | 'decorative'>,
): string | undefined {
  if (value.decorative) return '';
  return value.alt === undefined || value.alt === '' ? undefined : value.alt;
}

/**
 * Attributes of the createCMS image node in a rich text document. `assetId`
 * is required; a `src` (or any delivery URL) is rejected, so stored
 * documents only ever reference assets by id.
 */
export const richTextImageAttrsSchema: z.ZodType<RichTextImageAttrs> =
  z.strictObject({
    assetId: z.string().regex(ASSET_ID, 'Must be an asset id'),
    alt: z.string().max(1000).optional(),
    decorative: z.boolean().optional(),
    revisionId: z.string().regex(ASSET_ID, 'Must be an asset id').optional(),
    caption: z.string().max(2000).optional(),
  });

/**
 * Attributes of the link mark in a rich text document: an internal target
 * by `rootId` (optionally a `blockId`) or an external `href`.
 */
export const richTextLinkAttrsSchema: z.ZodType<RichTextLinkAttrs> = z.union([
  z.strictObject({
    rootId: z.string().min(1),
    blockId: z.string().min(1).optional(),
    target: z.literal('_blank').optional(),
  }),
  z.strictObject({
    href: z.string().min(1),
    target: z.literal('_blank').optional(),
    rel: z.string().optional(),
  }),
]);
