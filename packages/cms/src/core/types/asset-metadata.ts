import { z } from 'zod';

export type AssetProvenance =
  | 'unknown'
  | 'captured'
  | 'ai_generated'
  | 'ai_edited';

export const ASSET_PROVENANCES = [
  'unknown',
  'captured',
  'ai_generated',
  'ai_edited',
] as const satisfies readonly AssetProvenance[];

/** Descriptive data stored in `assets.metadata`. Never holds GPS data. */
export interface AssetMetadata {
  /** Focal point as fractions of width and height (0 to 1). */
  focal?: { x: number; y: number };
  placeholder?: { thumbhash: string };
  /** `#rrggbb`. */
  dominantColor?: string;
  rights?: {
    copyright?: string;
    credit?: string;
    license?: string;
    licenseUrl?: string;
    sourceUrl?: string;
    /** ISO 8601 date or date-time. */
    expiresAt?: string;
  };
  c2pa?: {
    present: boolean;
    validated?: boolean;
    claimGenerator?: string;
    aiActions?: string[];
  };
  iptcDigitalSourceType?: string;
  provenanceSource?: 'iptc' | 'c2pa' | 'user';
  exif?: {
    /** ISO 8601 date-time. */
    takenAt?: string;
    camera?: { make?: string; model?: string };
    colorSpace?: 'srgb' | 'display-p3' | 'other';
  };
  media?: {
    durationMs?: number;
    pageCount?: number;
    hasAlpha?: boolean;
    isAnimated?: boolean;
    frameCount?: number;
    videoCodec?: string;
    audioCodec?: string;
  };
  /** At most 2,000 characters. */
  description?: string;
  /** Note on a revision row, set by the replace that created it. */
  revisionNote?: string;
}

const fraction = z.number().min(0).max(1);
const isoDate = z.iso.date().or(z.iso.datetime({ offset: true }));
const shortText = z.string().max(500);

/**
 * Validates `AssetMetadata` on write. Unknown keys are rejected, so EXIF
 * outside the allowlist (GPS in particular) never reaches the database.
 */
export const assetMetadataSchema: z.ZodType<AssetMetadata> = z.strictObject({
  focal: z.strictObject({ x: fraction, y: fraction }).optional(),
  placeholder: z.strictObject({ thumbhash: z.string().max(100) }).optional(),
  dominantColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  rights: z
    .strictObject({
      copyright: shortText.optional(),
      credit: shortText.optional(),
      license: shortText.optional(),
      licenseUrl: z.url().optional(),
      sourceUrl: z.url().optional(),
      expiresAt: isoDate.optional(),
    })
    .optional(),
  c2pa: z
    .strictObject({
      present: z.boolean(),
      validated: z.boolean().optional(),
      claimGenerator: shortText.optional(),
      aiActions: z.array(shortText).max(50).optional(),
    })
    .optional(),
  iptcDigitalSourceType: shortText.optional(),
  provenanceSource: z.enum(['iptc', 'c2pa', 'user']).optional(),
  exif: z
    .strictObject({
      takenAt: z.iso.datetime({ offset: true, local: true }).optional(),
      camera: z
        .strictObject({
          make: shortText.optional(),
          model: shortText.optional(),
        })
        .optional(),
      colorSpace: z.enum(['srgb', 'display-p3', 'other']).optional(),
    })
    .optional(),
  media: z
    .strictObject({
      durationMs: z.number().int().nonnegative().optional(),
      pageCount: z.number().int().nonnegative().optional(),
      hasAlpha: z.boolean().optional(),
      isAnimated: z.boolean().optional(),
      frameCount: z.number().int().nonnegative().optional(),
      videoCodec: shortText.optional(),
      audioCodec: shortText.optional(),
    })
    .optional(),
  description: z.string().max(2000).optional(),
  revisionNote: z.string().max(2000).optional(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `patch` merged into `base` key by key; `null` in the patch removes a key.
 * Arrays and scalars replace.
 */
export function mergeMetadata(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeMetadata(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
