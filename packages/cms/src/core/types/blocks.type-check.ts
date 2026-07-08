/**
 * Type-level guarantees for `InferBlockProperties` — the block-property value
 * inference the typed content API (createBlock/updateBlock/getBlockTree) is
 * built on (ts-16). Ships nothing; covered by `tsc --noEmit`. A `@ts-expect-error`
 * that stops erroring fails the gate, so these double as regression tests.
 */
import { defineBlock } from '../define';
import type { InferBlockProperties } from './definitions';

const signup = defineBlock({
  label: 'Signup',
  properties: {
    headline: { type: 'string', label: 'Headline', required: true },
    ctaCount: { type: 'number', label: 'CTA count' }, // optional (no `required`)
    active: { type: 'boolean', label: 'Active', required: true },
  },
});

type Props = InferBlockProperties<typeof signup.properties>;

// Required props are present and value-typed (string/boolean); the optional one
// may be omitted.
export const _ok: Props = { headline: 'Join', active: true };
export const _okWithOptional: Props = { headline: 'Join', active: true, ctaCount: 2 };

// @ts-expect-error - `headline` is inferred `string`, not `number`
export const _wrongType: Props = { headline: 42, active: true };

// @ts-expect-error - required `active` is missing
export const _missingRequired: Props = { headline: 'Join' };

// @ts-expect-error - optional `ctaCount` is inferred `number`, not `string`
export const _optionalWrongType: Props = { headline: 'Join', active: true, ctaCount: 'two' };

// ---------------------------------------------------------------------------
// list + multi-reference property inference (cms-03)
// ---------------------------------------------------------------------------

const gallery = defineBlock({
  label: 'Gallery',
  properties: {
    // list of scalar → string[]
    tags: { type: 'list', of: { type: 'string' }, label: 'Tags', required: true },
    // list of number → number[]
    scores: { type: 'list', of: { type: 'number' }, label: 'Scores' },
    // list of reference → string[] (raw mode) — a multi-reference
    related: {
      type: 'list',
      of: { type: 'reference', collection: 'posts' },
      label: 'Related',
      required: true,
    },
    // list of select → union-of-options array
    sizes: {
      type: 'list',
      of: {
        type: 'select',
        options: [
          { label: 'S', value: 's' },
          { label: 'L', value: 'l' },
        ],
      },
      label: 'Sizes',
      required: true,
    },
  },
});

type GalleryProps = InferBlockProperties<typeof gallery.properties>;

// String/number/reference lists infer as arrays; select-list infers the option union.
export const _listOk: GalleryProps = {
  tags: ['a', 'b'],
  related: ['rot_1', 'rot_2'],
  sizes: ['s', 'l'],
  scores: [1, 2, 3],
};

// @ts-expect-error - `tags` elements are inferred `string`, not `number`
export const _listWrongElement: GalleryProps = { tags: [1], related: [], sizes: [] };

// @ts-expect-error - a list is an array, not a bare scalar
export const _listNotArray: GalleryProps = { tags: 'a', related: [], sizes: [] };

// @ts-expect-error - `sizes` elements are constrained to the option values
export const _listBadOption: GalleryProps = { tags: [], related: [], sizes: ['xl'] };

// @ts-expect-error - required list `related` is missing
export const _listMissingRequired: GalleryProps = { tags: [], sizes: [] };

// ---------------------------------------------------------------------------
// declarative constraint fields are accepted on the spec (cms-04)
// ---------------------------------------------------------------------------

const constrained = defineBlock({
  label: 'Constrained',
  properties: {
    title: { type: 'string', label: 'Title', minLength: 1, maxLength: 80, pattern: '^[A-Z]' },
    count: { type: 'number', label: 'Count', min: 0, max: 10 },
    body: { type: 'richText', label: 'Body', maxLength: 5000 },
  },
});

// Constrained props still infer to their base runtime types.
export const _constrainedOk: InferBlockProperties<typeof constrained.properties> = {
  title: 'Hello',
  count: 3,
  body: '<p>hi</p>',
};
