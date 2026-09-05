/**
 * Compile-time guarantees for the typed factory. Ships nothing (no entry
 * imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type {
  BlockTreeNode,
  CollectionDefinition,
  InferBlockTreeNode,
} from '@createcms/schema';

import type {
  BlockHandleOf,
  BlockPropsOf,
  BlockTypeOf,
  EditorFactory,
  PropValueOf,
  RootPropsOf,
  TreeOf,
  TypedEditorApi,
} from './factory';

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

// A schema as `defineCollection` would type it: `blocks?` optional in the type.
const pages = {
  label: 'Pages',
  root: {
    properties: {
      title: { type: 'string', label: 'Title', required: true },
      subtitle: { type: 'string', label: 'Subtitle' },
    },
  },
  blocks: {
    hero: {
      label: 'Hero',
      properties: {
        headline: { type: 'string', label: 'Headline', required: true },
        badge: { type: 'string', label: 'Badge' },
        level: { type: 'number', label: 'Level' },
      },
    },
    section: {
      label: 'Section',
      allowChildren: true,
      properties: {
        variant: {
          type: 'select',
          label: 'Variant',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        },
      },
    },
  },
} satisfies CollectionDefinition;
type Pages = typeof pages;

// The same schema through the optional-`blocks` `CollectionDefinition` shape.
type PagesOptional = CollectionDefinition<
  Pages['root']['properties'],
  NonNullable<Pages['blocks']>
>;

// A block-less schema (root only) and a dynamic one (index-signature blocks).
const settings = {
  label: 'Settings',
  root: { properties: { siteName: { type: 'string', label: 'Site name' } } },
} satisfies CollectionDefinition;
type Settings = typeof settings;
type Dynamic = CollectionDefinition;

// --- BlockTypeOf ------------------------------------------------------------
export type _blockTypes = Expect<Equal<BlockTypeOf<Pages>, 'hero' | 'section'>>;
export type _blockTypesOptional = Expect<
  Equal<BlockTypeOf<PagesOptional>, 'hero' | 'section'>
>;
export type _blockTypesSettings = Expect<Equal<BlockTypeOf<Settings>, never>>;
export type _blockTypesDynamic = Expect<Equal<BlockTypeOf<Dynamic>, never>>;

// --- BlockPropsOf / RootPropsOf ---------------------------------------------
export type _heroProps = Expect<
  MutuallyAssignable<
    BlockPropsOf<Pages, 'hero'>,
    { headline: string; badge?: string; level?: number }
  >
>;
export type _sectionSelectIsWide = Expect<
  MutuallyAssignable<BlockPropsOf<Pages, 'section'>, { variant?: string }>
>;
export type _rootProps = Expect<
  MutuallyAssignable<RootPropsOf<Pages>, { title: string; subtitle?: string }>
>;

// --- PropValueOf ------------------------------------------------------------
type HeroSpec = NonNullable<Pages['blocks']>['hero']['properties'];
export type _requiredValue = Expect<
  Equal<PropValueOf<HeroSpec, 'headline'>, string>
>;
export type _optionalValue = Expect<
  Equal<PropValueOf<HeroSpec, 'level'>, number | undefined>
>;

// --- TreeOf -----------------------------------------------------------------
type ExpectedTree = InferBlockTreeNode<
  NonNullable<Pages['blocks']>,
  Pages['root']['properties']
>;
export type _treeIsInfer = Expect<MutuallyAssignable<TreeOf<Pages>, ExpectedTree>>;
export type _treeIsBlockTreeNode = Expect<
  TreeOf<Pages> extends BlockTreeNode ? true : false
>;
const validTree: TreeOf<Pages> = {
  blockId: 'root_1',
  type: 'root',
  properties: { title: 'Home' },
  children: [
    {
      blockId: 'h1',
      type: 'hero',
      properties: { headline: 'Hi' },
      children: [],
    },
  ],
};
void validTree;
const badTree: TreeOf<Pages> = {
  blockId: 'root_1',
  type: 'root',
  properties: { title: 'Home' },
  children: [
    {
      blockId: 'x',
      // @ts-expect-error - 'paragraph' is not a block type of Pages
      type: 'paragraph',
      properties: {},
      children: [],
    },
  ],
};
void badTree;
// A block-less schema still has a tree: the root member alone.
const settingsTree: TreeOf<Settings> = {
  blockId: 'root_1',
  type: 'root',
  properties: { siteName: 'x' },
  children: [],
};
void settingsTree;

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
export type _typesTree = Expect<
  MutuallyAssignable<(typeof factory.types)['tree'], TreeOf<Pages>>
>;

// --- factory Preview render argument + scrollTo -----------------------------
type PreviewRenderArg = Parameters<
  Parameters<EditorFactory<Pages>['Preview']>[0]['render']
>[0];
export type _previewTreeArg = Expect<
  MutuallyAssignable<PreviewRenderArg, TreeOf<Pages>>
>;
type FramePreviewRenderArg = Parameters<
  Parameters<EditorFactory<Pages>['FramePreview']>[0]['render']
>[0];
export type _framePreviewTreeArg = Expect<
  MutuallyAssignable<FramePreviewRenderArg, TreeOf<Pages>>
>;
const scrolled: boolean = api.scrollTo('root_1');
void scrolled;
api.scrollTo('h1', { block: 'nearest' });
declare const scrollContainer: ParentNode;
api.scrollTo('h1', { container: scrollContainer });
