/**
 * Type-level guarantees for the shared block/collection type vocabulary.
 *
 * This file ships NOTHING (no `exports` entry references it, so bunchee never
 * builds it) but IS covered by `tsc --noEmit` (the type-check gate includes
 * `src` and excludes only `dist`). A `@ts-expect-error` that stops being an
 * error fails the gate ("unused '@ts-expect-error' directive"), so these
 * double as regression tests for the moved types.
 *
 * Deliberately imports NOTHING from `@createcms/core`: `defineBlock` /
 * `defineRoot` / `defineCollection` live there and wrap these same types with
 * a nicer runtime API, but `@createcms/schema` must type-check standalone.
 * `asBlock` / `asRoot` / `asCollection` below are local, type-only stand-ins
 * with the identical generic-inference signature, so a literal object here
 * gets its keys narrowed the same way core's `defineBlock`/`defineCollection`
 * narrow them for real callers.
 */
import type {
  AnyBlockDefinition,
  BlockDefinition,
  BlockProperty,
  CollectionDefinition,
  EventDeclaration,
  InferBlockProperties,
  InferBlockTreeNode,
  LinkValue,
  RequireTrackingId,
  ResolvedLink,
  ResolvedReference,
  RootDefinition,
} from './index';

// ---------------------------------------------------------------------------
// Local stand-ins for defineBlock/defineRoot/defineCollection (type-only —
// see the header comment: this package cannot import @createcms/core).
// ---------------------------------------------------------------------------

function asBlock<
  const TProps extends Record<string, BlockProperty>,
  const TEvents extends Record<string, EventDeclaration> = Record<
    string,
    never
  >,
>(
  block: BlockDefinition<TProps, TEvents> & RequireTrackingId<TProps, TEvents>,
): BlockDefinition<TProps, TEvents> {
  return block;
}

function asRoot<const TProps extends Record<string, BlockProperty>>(
  root: RootDefinition<TProps>,
): RootDefinition<TProps> {
  return root;
}

function asCollection<
  const TProps extends Record<string, BlockProperty>,
  const TBlocks extends Record<string, AnyBlockDefinition> = Record<
    string,
    never
  >,
>(
  collection: Omit<CollectionDefinition<TProps, TBlocks>, 'blocks'> & {
    blocks?: { [K in keyof TBlocks]: AnyBlockDefinition } & TBlocks;
  },
): CollectionDefinition<TProps, TBlocks> {
  return collection as CollectionDefinition<TProps, TBlocks>;
}

// ---------------------------------------------------------------------------
// A small collection exercising every field kind + every structure mode.
// ---------------------------------------------------------------------------

const root = asRoot({
  properties: {
    title: { type: 'string', label: 'Title', required: true },
  },
});

const hero = asBlock({
  label: 'Hero',
  properties: {
    headline: { type: 'string', label: 'Headline', required: true },
    subheadline: { type: 'string', label: 'Subheadline' },
  },
});

const featureItem = asBlock({
  label: 'Feature Item',
  properties: {
    text: { type: 'string', label: 'Text' },
  },
});

const kitchenSink = asBlock({
  label: 'Kitchen Sink',
  properties: {
    size: {
      type: 'select',
      label: 'Size',
      required: true,
      options: [
        { label: 'Small', value: 'sm' },
        { label: 'Large', value: 'lg' },
      ] as const,
    },
    tags: { type: 'list', of: { type: 'string' }, label: 'Tags' },
    related: {
      type: 'reference',
      label: 'Related',
      collection: 'posts',
    },
    cta: {
      type: 'link',
      label: 'CTA',
      allowedKinds: ['internal', 'external'],
    },
  },
});

const featureSection = asBlock({
  label: 'Feature Section',
  allowChildren: true,
  properties: { heading: { type: 'string', label: 'Heading' } },
});

const blocks = { hero, featureItem, kitchenSink, featureSection };

// --- valid: all three structure modes + the 'root' parent key ---------------
const ok = asCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    featureSection: { accepts: ['featureItem'] }, // whitelist
    root: { excludes: ['featureItem'] }, // blacklist (implicit '*' base)
    hero: { accepts: '*', excludes: ['featureItem'] }, // explicit '*' + blacklist
  },
});
void ok;

// --- invalid: excludes is forbidden alongside a concrete accepts list -------
const badStructure = asCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    featureSection: {
      accepts: ['featureItem'],
      // @ts-expect-error - excludes is forbidden when accepts is a concrete list
      excludes: ['hero'],
    },
  },
});
void badStructure;

// --- invalid: `link` cannot be a list element type ---------------------------
const badListElement = asBlock({
  label: 'Bad List',
  properties: {
    links: {
      type: 'list',
      // @ts-expect-error - `link` is excluded from ListElementType
      of: { type: 'link' },
      label: 'Links',
    },
  },
});
void badListElement;

// ---------------------------------------------------------------------------
// InferBlockProperties shapes
// ---------------------------------------------------------------------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// `asBlock`'s `const TProps` capture makes the inferred `properties` record
// (and its members) `readonly`, the same way `as const` would. That is exactly
// what preserves the LITERAL `required: true` / `type: 'string'` the property
// inference switches on — but a readonly-sourced mapped type is represented
// differently enough internally that the `Equal` trick below reports a false
// mismatch against a plain (non-readonly) expected object, even though both
// directions of assignability hold. `Writable` strips that one layer of
// readonly before the shape gets compared, without touching the moved types.
type Writable<T> = { -readonly [K in keyof T]: T[K] };

type HeroProps = InferBlockProperties<Writable<(typeof hero)['properties']>>;
// required key stays required, optional key stays optional.
export type _heroShape = Expect<
  Equal<HeroProps, { headline: string; subheadline?: string }>
>;

type FeatureItemProps = InferBlockProperties<
  Writable<(typeof featureItem)['properties']>
>;
// every property optional -> the whole object becomes optional (| undefined).
export type _featureItemShape = Expect<
  Equal<FeatureItemProps, { text?: string } | undefined>
>;

type SinkPropsRaw = InferBlockProperties<
  Writable<(typeof kitchenSink)['properties']>
>;
// select narrows to the option-value union; reference/link stay in raw form.
export type _sinkRawShape = Expect<
  Equal<
    SinkPropsRaw,
    {
      size: 'sm' | 'lg';
      tags?: string[];
      related?: string;
      cta?: LinkValue;
    }
  >
>;

type SinkPropsResolved = InferBlockProperties<
  Writable<(typeof kitchenSink)['properties']>,
  'resolved'
>;
// `resolved` mode inlines reference -> ResolvedReference and link -> ResolvedLink.
export type _sinkResolvedShape = Expect<
  Equal<
    SinkPropsResolved,
    {
      size: 'sm' | 'lg';
      tags?: string[];
      related?: ResolvedReference;
      cta?: ResolvedLink;
    }
  >
>;

// ---------------------------------------------------------------------------
// InferBlockTreeNode union
// ---------------------------------------------------------------------------

// `InferBlockTreeNode` reads each block's `properties` one level deeper than
// `Writable` (above) strips, so undo `const`'s readonly there too.
type WritableBlocks<T> = {
  [K in keyof T]: Omit<T[K], 'properties'> & {
    properties: Writable<T[K] extends { properties: infer P } ? P : never>;
  };
};

type Tree = InferBlockTreeNode<
  WritableBlocks<typeof blocks>,
  Writable<(typeof root)['properties']>
>;

export type _treeHasRoot = Expect<
  Equal<Extract<Tree, { type: 'root' }>['properties'], { title: string }>
>;
export type _treeHasHero = Expect<
  Equal<
    Extract<Tree, { type: 'hero' }>['properties'],
    { headline: string; subheadline?: string }
  >
>;
export type _treeHasFeatureItem = Expect<
  Equal<
    Extract<Tree, { type: 'featureItem' }>['properties'],
    { text?: string }
  >
>;
export type _treeHasKitchenSink = Expect<
  Equal<
    Extract<Tree, { type: 'kitchenSink' }>['properties'],
    { size: 'sm' | 'lg'; tags?: string[]; related?: string; cta?: LinkValue }
  >
>;
export type _treeHasFeatureSection = Expect<
  Equal<
    Extract<Tree, { type: 'featureSection' }>['properties'],
    { heading?: string }
  >
>;
