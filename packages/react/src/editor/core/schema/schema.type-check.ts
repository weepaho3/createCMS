/**
 * Compile-time guarantees for the editor schema types. Ships nothing (no
 * entry imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type { StandardSchemaV1 } from './standard-schema';
import type {
  FieldSpecOf,
  InferProps,
  LinkValue,
  Localized,
  MediaValue,
  ReferenceValue,
  Responsive,
} from './types';

import { defineComponent, defineEditorSchema } from './types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const all = defineComponent({
  label: 'All',
  fields: {
    text: { type: 'text', required: true },
    textarea: { type: 'textarea' },
    number: { type: 'number' },
    boolean: { type: 'boolean' },
    select: {
      type: 'select',
      options: [
        { label: 'A', value: 'a' },
        { label: 'B', value: 'b' },
      ],
    },
    multi: {
      type: 'select',
      multiple: true,
      options: [{ label: 'X', value: 'x' }],
    },
    date: { type: 'date' },
    color: { type: 'color' },
    richText: { type: 'richText' },
    media: { type: 'media' },
    link: { type: 'link' },
    reference: { type: 'reference', collection: 'pages' },
    tags: { type: 'list', of: { type: 'text' } },
    items: {
      type: 'list',
      of: {
        type: 'object',
        fields: {
          label: { type: 'text', required: true },
          size: { type: 'number' },
        },
      },
    },
    cta: {
      type: 'object',
      fields: { href: { type: 'link', required: true } },
    },
    gap: { type: 'number', responsive: true },
    headline: { type: 'text', localized: true },
    icon: { type: 'custom', kind: 'icon' },
  },
});

type Props = InferProps<typeof all.fields>;

export type _required = Expect<Equal<Props['text'], string>>;
export type _optional = Expect<Equal<Props['textarea'], string | undefined>>;
export type _number = Expect<Equal<Props['number'], number | undefined>>;
export type _boolean = Expect<Equal<Props['boolean'], boolean | undefined>>;
export type _select = Expect<Equal<Props['select'], 'a' | 'b' | undefined>>;
export type _multi = Expect<Equal<Props['multi'], 'x'[] | undefined>>;
export type _date = Expect<Equal<Props['date'], string | undefined>>;
export type _color = Expect<Equal<Props['color'], string | undefined>>;
export type _richText = Expect<Equal<Props['richText'], string | undefined>>;
export type _media = Expect<Equal<Props['media'], MediaValue | undefined>>;
export type _link = Expect<Equal<Props['link'], LinkValue | undefined>>;
export type _reference = Expect<
  Equal<Props['reference'], ReferenceValue | undefined>
>;
export type _list = Expect<Equal<Props['tags'], string[] | undefined>>;
export type _listOfObjects = Expect<
  Equal<
    Props['items'],
    { label: string; size?: number | undefined }[] | undefined
  >
>;
export type _object = Expect<
  Equal<Props['cta'], { href: LinkValue } | undefined>
>;
export type _responsive = Expect<
  Equal<Props['gap'], Responsive<number> | undefined>
>;
export type _localized = Expect<
  Equal<Props['headline'], Localized<string> | undefined>
>;
export type _custom = Expect<Equal<Props['icon'], unknown>>;

// A custom field with a schema infers the schema's output.
declare const iconSchema: StandardSchemaV1<unknown, { name: string }>;
const typedCustom = defineComponent({
  label: 'Typed',
  fields: { icon: { type: 'custom', kind: 'icon', schema: iconSchema } },
});
export type _customSchema = Expect<
  Equal<InferProps<typeof typedCustom.fields>['icon'], { name: string } | undefined>
>;

// FieldSpecOf picks the right union member.
export type _spec = Expect<
  Equal<FieldSpecOf<'select'>['options'], readonly { readonly label: string; readonly value: string }[]>
>;

// Schemas keep their component names.
const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: { all, typed: typedCustom },
});
export type _names = Expect<
  Equal<keyof typeof schema.components, 'all' | 'typed'>
>;

defineComponent({
  label: 'Bad',
  fields: {
    // @ts-expect-error an unknown field kind
    x: { type: 'string' },
  },
});

defineComponent({
  label: 'Bad default',
  fields: {
    // @ts-expect-error a text default must be a string
    x: { type: 'text', defaultValue: 1 },
  },
});
