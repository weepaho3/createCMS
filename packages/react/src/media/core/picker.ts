import type { FilterState } from './filter';
import type { IntakeConstraints, IntakeRejectReason } from './intake';
import type { MediaAsset } from './types';

import { acceptsFile } from './intake';

/**
 * What a picker accepts. The same constraints lock unsuitable assets in the
 * grid and reject unsuitable uploads, with the same reason, so a too small
 * image cannot be uploaded and then not be chosen.
 */
export type PickerConstraints = {
  mode: 'single' | 'multiple';
  /** Multiple mode: at least this many. */
  min?: number;
  /** Multiple mode: at most this many; further assets lock. */
  max?: number;
  /** Types or prefixes such as `image/*`, or extensions such as `.pdf`. */
  accept?: string[];
  maxBytes?: number;
  minWidth?: number;
  minHeight?: number;
  /** Width / height with a relative tolerance (default 0.01). */
  aspect?: { ratio: number; tolerance?: number };
  /** Offer uploads in the picker. @default true */
  allowUpload?: boolean;
  /** Folder to open; `null` is the root level. */
  folderId?: string | null;
  /** Extra filter applied to the listing. */
  filters?: Partial<FilterState>;
  /** A crop preset id asked for after the choice. */
  cropPreset?: string;
  /** The choice needs alt text or "decorative". */
  requireAlt?: boolean;
};

/** Why an asset cannot be chosen; the same codes as intake rejections. */
export type PickerDisabledReason = Exclude<IntakeRejectReason, 'count'> | 'max';

/** The intake constraints of a picker, for uploads inside it. */
export function intakeConstraintsOf(
  constraints: PickerConstraints,
): IntakeConstraints {
  const out: IntakeConstraints = {};
  if (constraints.accept?.length) out.accept = constraints.accept.join(',');
  if (constraints.maxBytes !== undefined) out.maxSize = constraints.maxBytes;
  if (constraints.minWidth !== undefined) out.minWidth = constraints.minWidth;
  if (constraints.minHeight !== undefined)
    out.minHeight = constraints.minHeight;
  if (constraints.aspect) {
    out.aspect = constraints.aspect.ratio;
    out.aspectTolerance = constraints.aspect.tolerance;
  }
  if (constraints.mode === 'single') out.maxFiles = 1;
  else if (constraints.max !== undefined) out.maxFiles = constraints.max;
  return out;
}

/**
 * The listing filter of a picker: the MIME types of `accept` go to the
 * server so the grid shows matching assets only, merged with `filters`.
 */
export function pickerFilter(constraints: PickerConstraints): FilterState {
  const filter: FilterState = { sort: 'created_desc', ...constraints.filters };
  const mime = (constraints.accept ?? []).filter((rule) => rule.includes('/'));
  if (mime.length > 0) filter.mime = mime;
  if (constraints.folderId !== undefined)
    filter.folderId = constraints.folderId;
  if (constraints.minWidth !== undefined)
    filter.widthMin = constraints.minWidth;
  if (constraints.minHeight !== undefined)
    filter.heightMin = constraints.minHeight;
  return filter;
}

/**
 * Why `asset` cannot be chosen under `constraints`, or `null`. `selected`
 * is the current choice: at `max`, every other asset locks with `max`.
 */
export function pickerDisabledReason(
  asset: Pick<
    MediaAsset,
    'id' | 'mimeType' | 'size' | 'width' | 'height' | 'slug' | 'originalName'
  >,
  constraints: PickerConstraints,
  selected: readonly string[] = [],
): PickerDisabledReason | null {
  const name = asset.originalName ?? asset.slug;
  if (
    constraints.accept?.length &&
    !acceptsFile(constraints.accept.join(','), { name, type: asset.mimeType })
  ) {
    return 'type';
  }
  if (constraints.maxBytes !== undefined && asset.size > constraints.maxBytes)
    return 'size';
  const { width, height } = asset;
  if (
    constraints.minWidth !== undefined ||
    constraints.minHeight !== undefined
  ) {
    if (!width || !height) return 'dimensions';
    if (
      (constraints.minWidth !== undefined && width < constraints.minWidth) ||
      (constraints.minHeight !== undefined && height < constraints.minHeight)
    ) {
      return 'dimensions';
    }
  }
  if (constraints.aspect) {
    if (!width || !height) return 'aspect';
    const tolerance = constraints.aspect.tolerance ?? 0.01;
    if (
      Math.abs(width / height - constraints.aspect.ratio) >
      tolerance * constraints.aspect.ratio
    ) {
      return 'aspect';
    }
  }
  if (
    constraints.mode === 'multiple' &&
    constraints.max !== undefined &&
    selected.length >= constraints.max &&
    !selected.includes(asset.id)
  ) {
    return 'max';
  }
  return null;
}

/** Whether the current choice can be confirmed. */
export function canConfirmPicker(
  constraints: PickerConstraints,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return false;
  if (constraints.mode === 'single') return selected.length === 1;
  if (constraints.min !== undefined && selected.length < constraints.min)
    return false;
  if (constraints.max !== undefined && selected.length > constraints.max)
    return false;
  return true;
}

// --- replace -------------------------------------------------------------------

export type ReplaceWarning =
  | { code: 'type'; from: string; to: string }
  | { code: 'aspect'; from: number; to: number }
  | { code: 'usage'; roots: number };

/** Relative difference above which a new aspect ratio warns. */
export const REPLACE_ASPECT_TOLERANCE = 0.02;

/**
 * Warnings before replacing the bytes of `asset` with `file`: another type,
 * another aspect ratio (check the focal point and crops), and how many pages
 * will show the new file.
 */
export function replaceWarnings(
  asset: Pick<MediaAsset, 'mimeType' | 'width' | 'height'>,
  file: { type: string; width?: number | null; height?: number | null },
  usage?: { roots: number } | null,
): ReplaceWarning[] {
  const warnings: ReplaceWarning[] = [];
  if (file.type && file.type !== asset.mimeType) {
    warnings.push({ code: 'type', from: asset.mimeType, to: file.type });
  }
  if (asset.width && asset.height && file.width && file.height) {
    const from = asset.width / asset.height;
    const to = file.width / file.height;
    if (Math.abs(from - to) > REPLACE_ASPECT_TOLERANCE * from) {
      warnings.push({ code: 'aspect', from, to });
    }
  }
  if (usage && usage.roots > 0)
    warnings.push({ code: 'usage', roots: usage.roots });
  return warnings;
}

/** The common ratio label of an aspect: `16:9`, `4:3`, `1:1`, or `1.85:1`. */
export function aspectLabel(aspect: number): string {
  const known: [number, string][] = [
    [1, '1:1'],
    [4 / 3, '4:3'],
    [3 / 4, '3:4'],
    [16 / 9, '16:9'],
    [9 / 16, '9:16'],
    [3 / 2, '3:2'],
    [2 / 3, '2:3'],
    [4 / 5, '4:5'],
    [1200 / 630, '1.91:1'],
  ];
  for (const [value, label] of known) {
    if (Math.abs(aspect - value) < 0.01 * value) return label;
  }
  return `${Math.round(aspect * 100) / 100}:1`;
}
