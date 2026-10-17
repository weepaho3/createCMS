// ============================================================================
// Asset references (the stored value of an `image` property)
// ============================================================================

/** A rectangle or point as fractions of the image's width and height (0 to 1). */
export type AssetCrop = { x: number; y: number; width: number; height: number };

/**
 * One use of an asset in content. Alt text, caption, crop and focal point
 * belong to the use, not to the asset, so they are versioned, branched,
 * merged and translated with the block that holds them.
 */
export interface AssetRef {
  assetId: string;
  alt?: string;
  /** The image adds nothing to the text; renderers emit `alt=""`. */
  decorative?: boolean;
  altSource?: 'user' | 'ai-suggested';
  caption?: string;
  /** Pins a revision of the asset (`revisionOf === assetId`). */
  revisionId?: string;
  crop?: AssetCrop;
  focal?: { x: number; y: number };
}

/** The value of an `image` property: a bare asset id or an {@link AssetRef}. */
export type ImageValue = string | AssetRef;

/**
 * Attributes of the createCMS image node in rich text. The node stores the
 * asset id, never a delivery URL; renderers derive `src` from `assetId`.
 */
export interface RichTextImageAttrs {
  assetId: string;
  alt?: string;
  decorative?: boolean;
  revisionId?: string;
  caption?: string;
}

/**
 * Attributes of the link mark in rich text: an internal target by root id
 * (and optionally a block), or an external `href`.
 */
export type RichTextLinkAttrs =
  | { rootId: string; blockId?: string; target?: '_blank' }
  | { href: string; target?: '_blank'; rel?: string };
