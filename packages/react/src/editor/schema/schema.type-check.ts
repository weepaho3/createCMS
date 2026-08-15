/**
 * Compile-time guarantees for the editor schema types. Ships nothing (no
 * entry imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type {
  BlockProperty,
  CollectionDefinition,
  InferBlockProperties,
  LinkValue,
} from '@createcms/schema';

import type {
  AnyEditorSchema,
  EditorSchema,
  FieldKind,
  FieldSpecOf,
  FieldValueOf,
} from './types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// FieldKind is exactly the closed set of property `type` tags (incl. `list`).
export type _fieldKindIsClosed = Expect<Equal<FieldKind, BlockProperty['type']>>;

// FieldSpecOf picks the right union member.
export type _selectSpecHasOptions = Expect<
  FieldSpecOf<'select'> extends { options: readonly { value: string }[] }
    ? true
    : false
>;
export type _listSpecHasOf = Expect<
  FieldSpecOf<'list'> extends { of: unknown } ? true : false
>;
export type _linkSpecHasKinds = Expect<
  FieldSpecOf<'link'> extends { allowedKinds?: readonly string[] } ? true : false
>;

// FieldValueOf<K> equals what InferBlockProperties derives for a (required)
// property of that kind — the single source of truth for value types. The
// `Extract<…, { v: unknown }>` strips the `| undefined` branch that stays
// deferred while `K` is generic (indexing without it is a TS2536 error).
type Inferred<K extends FieldKind> = Extract<
  InferBlockProperties<{ v: FieldSpecOf<K> & { required: true } }>,
  { v: unknown }
>['v'];

export type _string = Expect<Equal<FieldValueOf<'string'>, Inferred<'string'>>>;
export type _number = Expect<Equal<FieldValueOf<'number'>, Inferred<'number'>>>;
export type _boolean = Expect<
  Equal<FieldValueOf<'boolean'>, Inferred<'boolean'>>
>;
export type _date = Expect<Equal<FieldValueOf<'date'>, Inferred<'date'>>>;
export type _richText = Expect<
  Equal<FieldValueOf<'richText'>, Inferred<'richText'>>
>;
export type _image = Expect<Equal<FieldValueOf<'image'>, Inferred<'image'>>>;
export type _select = Expect<Equal<FieldValueOf<'select'>, Inferred<'select'>>>;
export type _reference = Expect<
  Equal<FieldValueOf<'reference'>, Inferred<'reference'>>
>;
export type _link = Expect<Equal<FieldValueOf<'link'>, Inferred<'link'>>>;
export type _linkIsLinkValue = Expect<Equal<FieldValueOf<'link'>, LinkValue>>;
export type _list = Expect<Equal<FieldValueOf<'list'>, Inferred<'list'>>>;

// A createcms collection definition IS an editor schema (and vice versa).
export type _schemaIsCollection = Expect<
  Equal<EditorSchema, CollectionDefinition>
>;
export type _anySchema = Expect<
  Equal<AnyEditorSchema, CollectionDefinition>
>;

// A literal collection (as `defineCollection` would narrow it) is assignable
// to the wide schema every helper accepts.
const literal = {
  label: 'Pages',
  root: { properties: { title: { type: 'string', label: 'Title' } } },
  blocks: {
    section: {
      label: 'Section',
      allowChildren: true,
      properties: {},
    },
  },
  structure: { section: { accepts: ['section'] } },
} satisfies CollectionDefinition;
const wide: AnyEditorSchema = literal;
void wide;

// `structure` keeps its compile-time guard: excludes is forbidden next to a
// concrete accepts list (same layout as packages/schema/src/schema.type-check.ts —
// the directive sits directly above the offending `excludes` line).
const badStructure = {
  label: 'Pages',
  root: { properties: {} },
  blocks: { a: { label: 'A', properties: {} } },
  structure: {
    a: {
      accepts: ['a'],
      // @ts-expect-error - excludes is forbidden when accepts is a concrete list
      excludes: ['a'],
    },
  },
} satisfies AnyEditorSchema;
void badStructure;
