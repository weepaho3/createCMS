/**
 * The image field of a block: one use of an asset with its own alt text,
 * decorative switch, caption, crop and focal point. A library-wide alt text
 * does not exist; an AI suggestion is copied in only when accepted.
 */

import type { FocalPoint, UsageCrop } from './image-edit';

/** The stored value of an image use (`AssetRef` of `@createcms/core`). */
export type ImageRef = {
  assetId: string;
  alt?: string;
  decorative?: boolean;
  altSource?: 'user' | 'ai-suggested';
  caption?: string;
  revisionId?: string;
  crop?: UsageCrop;
  focal?: FocalPoint;
};

/** A stored image value: a bare id or a reference. */
export type ImageFieldValue = string | ImageRef;

export type AltState = 'present' | 'decorative' | 'missing';

export function toImageRef(value: ImageFieldValue): ImageRef {
  return typeof value === 'string' ? { assetId: value } : value;
}

export function altStateOf(
  value: ImageFieldValue | null | undefined,
): AltState {
  if (!value || typeof value === 'string') return 'missing';
  if (value.decorative) return 'decorative';
  return value.alt?.trim() ? 'present' : 'missing';
}

/** Whether the use may be saved or inserted under `requireAlt`. */
export function satisfiesAlt(
  value: ImageFieldValue | null | undefined,
  requireAlt = false,
): boolean {
  return !requireAlt || altStateOf(value) !== 'missing';
}

/** Typed alt text: a person wrote it (`altSource: 'user'`), and it is not decorative. */
export function setAlt(value: ImageFieldValue, alt: string): ImageRef {
  const ref = toImageRef(value);
  const next: ImageRef = { ...ref, alt, altSource: 'user' };
  delete next.decorative;
  if (!alt) {
    delete next.alt;
    delete next.altSource;
  }
  return next;
}

/** Decorative images render `alt=""`; the alt text is kept for undoing. */
export function setDecorative(
  value: ImageFieldValue,
  decorative: boolean,
): ImageRef {
  const ref = toImageRef(value);
  const next: ImageRef = { ...ref };
  if (decorative) next.decorative = true;
  else delete next.decorative;
  return next;
}

export function setCaption(value: ImageFieldValue, caption: string): ImageRef {
  const next: ImageRef = { ...toImageRef(value), caption };
  if (!caption) delete next.caption;
  return next;
}

/**
 * Accepts a suggestion: only into an empty, non-decorative alt text, marked
 * `altSource: 'ai-suggested'`. A person's text is never overwritten.
 */
export function acceptAltSuggestion(
  value: ImageFieldValue,
  suggestion: string,
): ImageRef {
  const ref = toImageRef(value);
  if (altStateOf(ref) !== 'missing' || !suggestion.trim()) return ref;
  return { ...ref, alt: suggestion.trim(), altSource: 'ai-suggested' };
}

/**
 * The value after choosing another asset for the same use: alt text,
 * decorative and caption stay; the revision pin goes (it belongs to the old
 * asset), and so does the crop when the aspect ratio differs.
 */
export function replaceImageAsset(
  value: ImageFieldValue,
  assetId: string,
  options: { keepCrop?: boolean } = {},
): ImageRef {
  const ref = toImageRef(value);
  const next: ImageRef = { ...ref, assetId };
  delete next.revisionId;
  if (!options.keepCrop) delete next.crop;
  return next;
}

/** What an alt text suggester gets to describe an image in its place. */
export type AltSuggestContext = {
  fieldType?: string;
  surroundingText?: string;
  pageTitle?: string;
  locale?: string;
  linkTarget?: string;
};

/** Suggests alt text (a browser model, a vision API); `null` when it has none. */
export type AltSuggestAdapter = {
  suggest(input: {
    assetId: string;
    context: AltSuggestContext;
  }): Promise<string | null>;
};

/**
 * Asks the adapters in order and returns the first suggestion, so a cheap
 * local model can precede a server fallback. Adapter errors count as no
 * suggestion.
 */
export async function suggestAlt(
  adapters: readonly AltSuggestAdapter[],
  input: { assetId: string; context: AltSuggestContext },
): Promise<string | null> {
  for (const adapter of adapters) {
    try {
      const text = (await adapter.suggest(input))?.trim();
      if (text) return text;
    } catch {
      // Try the next adapter.
    }
  }
  return null;
}
