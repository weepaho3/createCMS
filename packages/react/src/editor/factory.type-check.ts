/**
 * Compile-time guarantees for the typed factory. Ships nothing (no entry
 * imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type { EditorDocument } from './core/document';
import type { AnyEditorSchema } from './core/schema';
import type {
  BlockHandleOf,
  BlockPropsOf,
  BlockTypeOf,
  DocumentOf,
  EditorFactory,
  PropValueOf,
  RootPropsOf,
  TypedEditorApi,
} from './factory';

import { defineEditorSchema } from './core/schema';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;
type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

const pages = defineEditorSchema({
  root: {
    label: 'Pages',
    fields: {
      title: { type: 'text', label: 'Title', required: true },
      subtitle: { type: 'text', label: 'Subtitle' },
    },
    slots: { children: {} },
  },
  components: {
    hero: {
      label: 'Hero',
      fields: {
        headline: { type: 'text', label: 'Headline', required: true },
        badge: { type: 'text', label: 'Badge' },
        level: { type: 'number', label: 'Level' },
      },
    },
    section: {
      label: 'Section',
      fields: {
        variant: {
          type: 'select',
          label: 'Variant',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        },
      },
      slots: { children: {} },
    },
  },
});
type Pages = typeof pages;

// A component-less schema (root only) and a dynamic one (index-signature components).
const settings = defineEditorSchema({
  root: {
    label: 'Settings',
    fields: { siteName: { type: 'text', label: 'Site name' } },
    slots: { children: {} },
  },
  components: {},
});
type Settings = typeof settings;
type Dynamic = AnyEditorSchema;

// --- BlockTypeOf ------------------------------------------------------------
export type _blockTypes = Expect<Equal<BlockTypeOf<Pages>, 'hero' | 'section'>>;
export type _blockTypesSettings = Expect<Equal<BlockTypeOf<Settings>, never>>;
export type _blockTypesDynamic = Expect<Equal<BlockTypeOf<Dynamic>, never>>;

// --- BlockPropsOf / RootPropsOf ---------------------------------------------
export type _heroProps = Expect<
  MutuallyAssignable<
    BlockPropsOf<Pages, 'hero'>,
    { headline: string; badge?: string; level?: number }
  >
>;
export type _sectionSelectIsNarrow = Expect<
  MutuallyAssignable<BlockPropsOf<Pages, 'section'>, { variant?: 'a' | 'b' }>
>;
export type _rootProps = Expect<
  MutuallyAssignable<RootPropsOf<Pages>, { title: string; subtitle?: string }>
>;

// --- PropValueOf ------------------------------------------------------------
type HeroSpec = Pages['components']['hero']['fields'];
export type _requiredValue = Expect<
  Equal<PropValueOf<HeroSpec, 'headline'>, string>
>;
export type _optionalValue = Expect<
  Equal<PropValueOf<HeroSpec, 'level'>, number>
>;

// --- DocumentOf -------------------------------------------------------------
const validDoc: DocumentOf<Pages> = {
  schemaVersion: 1,
  root: {
    id: 'root_1',
    type: 'root',
    props: { title: 'Home' },
    slots: {
      children: [{ id: 'h1', type: 'hero', props: { headline: 'Hi' } }],
    },
  },
};
void validDoc;
export type _documentRootIsRoot = Expect<
  DocumentOf<Pages>['root']['type'] extends EditorDocument['root']['type']
    ? true
    : false
>;
const badDoc: DocumentOf<Pages> = {
  schemaVersion: 1,
  root: {
    id: 'root_1',
    type: 'root',
    props: { title: 'Home' },
    slots: {
      children: [
        {
          id: 'x',
          // @ts-expect-error - 'paragraph' is not a component type of Pages
          type: 'paragraph',
          props: {},
        },
      ],
    },
  },
};
void badDoc;
const badProps: DocumentOf<Pages> = {
  schemaVersion: 1,
  root: {
    id: 'root_1',
    type: 'root',
    // @ts-expect-error - the required root title is missing
    props: {},
  },
};
void badProps;
// A component-less schema still has a document: the root alone.
const settingsDoc: DocumentOf<Settings> = {
  schemaVersion: 1,
  root: { id: 'root_1', type: 'root', props: { siteName: 'x' } },
};
void settingsDoc;

// --- typed add --------------------------------------------------------------
declare const api: TypedEditorApi<Pages>;
api.add('hero', { parentId: 'root_1', properties: { headline: 'x' } });
api.add('section', { parentId: 'root_1', index: 0 });
// @ts-expect-error - unknown block type
api.add('paragraph', { parentId: 'root_1' });
// @ts-expect-error - wrong property type
api.add('hero', { parentId: 'root_1', properties: { headline: 1 } });
// @ts-expect-error - unknown property
api.add('hero', { parentId: 'root_1', properties: { nope: 'x' } });

declare const settingsApi: TypedEditorApi<Settings>;
// @ts-expect-error - a block-less schema cannot add blocks (type is never)
settingsApi.add('anything', { parentId: 'root_1' });

// --- typed block handle -----------------------------------------------------
declare const block: NonNullable<BlockHandleOf<Pages>>;
if (block.type === 'hero') {
  const headline: string = block.properties.headline;
  void headline;
  block.set('headline', 'Neu');
  block.set('badge', null);
  // @ts-expect-error - wrong value type
  block.set('level', 'high');
  // @ts-expect-error - unknown key
  block.set('nope', 1);
  const field = block.field('badge');
  const value: string | undefined = field.value;
  void value;
  // @ts-expect-error - unknown key
  block.field('nope');
}
if (block.type === 'root') {
  const title: string = block.properties.title;
  void title;
  block.set('subtitle', 'x');
}
// Without narrowing, `set` is not callable (union of generic methods).
// @ts-expect-error - narrow on `type` first
block.set('headline', 'x');

// --- factory shape ----------------------------------------------------------
declare const factory: EditorFactory<Pages>;
type FieldValue = ReturnType<typeof factory.useField<'hero', 'headline'>>['value'];
export type _fieldValue = Expect<Equal<FieldValue, string | undefined>>;
type Palette = ReturnType<typeof factory.usePalette>;
export type _paletteType = Expect<
  Equal<Palette[number]['type'], 'hero' | 'section'>
>;
type ChildType = ReturnType<typeof factory.useChildren>[number]['type'];
export type _childType = Expect<Equal<ChildType, 'hero' | 'section'>>;
factory.useBlockActions('x').add('hero', { properties: {} });
// @ts-expect-error - unknown block type
factory.useBlockActions('x').add('nope');
export type _allowedChildTypes = Expect<
  Equal<
    ReturnType<typeof factory.useBlockActions>['allowedChildTypes'],
    readonly ('hero' | 'section')[]
  >
>;
declare const settingsFactory: EditorFactory<Settings>;
export type _settingsPalette = Expect<
  Equal<ReturnType<typeof settingsFactory.usePalette>, never>
>;
export type _settingsChildType = Expect<
  Equal<ReturnType<typeof settingsFactory.useChildren>[number]['type'], never>
>;
export type _typesDocument = Expect<
  MutuallyAssignable<(typeof factory.types)['document'], DocumentOf<Pages>>
>;

// --- factory Preview render argument + scrollTo -----------------------------
type PreviewRenderArg = Parameters<
  Parameters<EditorFactory<Pages>['Preview']>[0]['render']
>[0];
export type _previewDocumentArg = Expect<
  MutuallyAssignable<PreviewRenderArg, DocumentOf<Pages>>
>;
type FramePreviewRenderArg = Parameters<
  Parameters<EditorFactory<Pages>['FramePreview']>[0]['render']
>[0];
export type _framePreviewDocumentArg = Expect<
  MutuallyAssignable<FramePreviewRenderArg, DocumentOf<Pages>>
>;
const scrolled: boolean = api.scrollTo('root_1');
void scrolled;
api.scrollTo('h1', { block: 'nearest' });
declare const scrollContainer: ParentNode;
api.scrollTo('h1', { container: scrollContainer });
