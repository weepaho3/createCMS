import type { AssetPatch } from './store';
import type { MediaAsset } from './types';

/**
 * The detail form of an asset: file properties, rights and provenance. Alt
 * text is not here: it belongs to each use on a block. The draft holds only
 * what the user changed; `assetPatch` turns it into an `updateAsset` patch.
 */

export type AssetRights = {
  credit?: string;
  copyright?: string;
  sourceUrl?: string;
  license?: string;
  licenseUrl?: string;
  /** ISO date or date-time. */
  expiresAt?: string;
};

export type AssetProvenanceValue =
  | 'unknown'
  | 'captured'
  | 'ai_generated'
  | 'ai_edited';

/** The editable fields of the detail form. */
export type DetailValues = {
  originalName: string;
  /** Internal note for the library search; never used as alt text. */
  description: string;
  rights: AssetRights;
  provenance: AssetProvenanceValue;
  /** Project-defined metadata, validated by the server. */
  custom: Record<string, unknown>;
};

export type DetailField =
  | 'originalName'
  | 'description'
  | 'provenance'
  | `rights.${keyof AssetRights}`
  | `custom.${string}`;

/** Keys of `metadata` the form owns; everything else is custom metadata. */
const OWN_METADATA = new Set([
  'description',
  'rights',
  'focal',
  'placeholder',
  'dominantColor',
  'c2pa',
  'iptcDigitalSourceType',
  'provenanceSource',
  'exif',
  'media',
  'revisionNote',
]);

type Metadata = {
  description?: string;
  rights?: AssetRights;
  provenanceSource?: 'iptc' | 'c2pa' | 'user';
  c2pa?: {
    present: boolean;
    validated?: boolean;
    claimGenerator?: string;
    aiActions?: string[];
  };
  [key: string]: unknown;
};

function metadataOf(asset: MediaAsset): Metadata {
  return (asset.metadata ?? {}) as Metadata;
}

/** The form values of an asset. */
export function detailValues(asset: MediaAsset): DetailValues {
  const metadata = metadataOf(asset);
  const custom: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!OWN_METADATA.has(key)) custom[key] = value;
  }
  return {
    originalName: asset.originalName ?? asset.slug,
    description: metadata.description ?? '',
    rights: { ...metadata.rights },
    provenance: asset.provenance ?? 'unknown',
    custom,
  };
}

/** A partial set of changed values. */
export type DetailDraft = Partial<Omit<DetailValues, 'rights' | 'custom'>> & {
  rights?: Partial<AssetRights>;
  custom?: Record<string, unknown>;
};

/** `draft` with `field` set to `value`. */
export function setDraftField(
  draft: DetailDraft,
  field: DetailField,
  value: unknown,
): DetailDraft {
  if (field.startsWith('rights.')) {
    const key = field.slice('rights.'.length) as keyof AssetRights;
    return { ...draft, rights: { ...draft.rights, [key]: value as string } };
  }
  if (field.startsWith('custom.')) {
    const key = field.slice('custom.'.length);
    return { ...draft, custom: { ...draft.custom, [key]: value } };
  }
  return { ...draft, [field]: value };
}

/** The current value of `field`: the draft over the asset. */
export function draftValue(
  values: DetailValues,
  draft: DetailDraft,
  field: DetailField,
): unknown {
  if (field.startsWith('rights.')) {
    const key = field.slice('rights.'.length) as keyof AssetRights;
    return draft.rights && key in draft.rights
      ? draft.rights[key]
      : values.rights[key];
  }
  if (field.startsWith('custom.')) {
    const key = field.slice('custom.'.length);
    return draft.custom && key in draft.custom
      ? draft.custom[key]
      : values.custom[key];
  }
  const key = field as keyof Omit<DetailValues, 'rights' | 'custom'>;
  return key in draft ? draft[key] : values[key];
}

const emptyToUndefined = (value: unknown) =>
  value === '' || value === null ? undefined : value;

/**
 * Whether `draft` changes anything compared with `values` (an empty string
 * equals a missing value).
 */
export function isDirty(values: DetailValues, draft: DetailDraft): boolean {
  const differs = (a: unknown, b: unknown) =>
    JSON.stringify(emptyToUndefined(a)) !== JSON.stringify(emptyToUndefined(b));
  if (
    draft.originalName !== undefined &&
    differs(draft.originalName, values.originalName)
  )
    return true;
  if (
    draft.description !== undefined &&
    differs(draft.description, values.description)
  )
    return true;
  if (draft.provenance !== undefined && draft.provenance !== values.provenance)
    return true;
  for (const [key, value] of Object.entries(draft.rights ?? {})) {
    if (differs(value, values.rights[key as keyof AssetRights])) return true;
  }
  for (const [key, value] of Object.entries(draft.custom ?? {})) {
    if (differs(value, values.custom[key])) return true;
  }
  return false;
}

/**
 * The `updateAsset` patch of a draft: the changed top-level fields and the
 * changed metadata keys. The server merges metadata key by key (nested
 * objects too) and removes keys set to `null`, so a cleared field is sent
 * as `null`. `null` when nothing changed.
 */
export function assetPatch(
  asset: MediaAsset,
  draft: DetailDraft,
): AssetPatch | null {
  const values = detailValues(asset);
  if (!isDirty(values, draft)) return null;
  const patch: AssetPatch = {};
  const name = draft.originalName?.trim();
  if (name && name !== values.originalName) patch.originalName = name;
  if (
    draft.provenance !== undefined &&
    draft.provenance !== values.provenance
  ) {
    patch.provenance = draft.provenance;
  }
  const text = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';
  const metadata: Record<string, unknown> = {};
  if (
    draft.description !== undefined &&
    text(draft.description) !== values.description
  ) {
    metadata.description = text(draft.description) || null;
  }
  const rights: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(draft.rights ?? {})) {
    if (text(value) !== (values.rights[key as keyof AssetRights] ?? '')) {
      rights[key] = text(value) || null;
    }
  }
  if (Object.keys(rights).length > 0) metadata.rights = rights;
  for (const [key, value] of Object.entries(draft.custom ?? {})) {
    metadata[key] = emptyToUndefined(value) ?? null;
  }
  if (Object.keys(metadata).length > 0) patch.metadata = metadata;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Read-only facts of the detail view. */
export type AssetFacts = {
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  originalName: string;
  uploadedBy: string | null;
  createdAt: string;
  /** Where the provenance came from: IPTC, C2PA or a person. */
  provenanceSource: 'iptc' | 'c2pa' | 'user' | null;
  c2pa: {
    present: boolean;
    validated: boolean;
    claimGenerator: string | null;
    aiActions: string[];
  } | null;
};

export function assetFacts(asset: MediaAsset): AssetFacts {
  const metadata = metadataOf(asset);
  return {
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width ?? null,
    height: asset.height ?? null,
    originalName: asset.originalName ?? asset.slug,
    uploadedBy: asset.uploadedBy,
    createdAt: new Date(asset.createdAt).toISOString(),
    provenanceSource: metadata.provenanceSource ?? null,
    c2pa: metadata.c2pa
      ? {
          present: metadata.c2pa.present,
          validated: metadata.c2pa.validated ?? false,
          claimGenerator: metadata.c2pa.claimGenerator ?? null,
          aiActions: metadata.c2pa.aiActions ?? [],
        }
      : null,
  };
}

/** A suggestion (from AI or a rule) shown next to a field until accepted. */
export type DetailSuggestion = {
  field: DetailField;
  value: string;
  source: string;
};
