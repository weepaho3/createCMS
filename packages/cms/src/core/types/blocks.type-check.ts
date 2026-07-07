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
