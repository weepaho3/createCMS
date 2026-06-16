import type {
  AnyBlockDefinition,
  AnyCollectionDefinition,
  BlockDefinition,
  BlockProperty,
  CMSMiddleware,
  CollectionDefinition,
  EventDeclaration,
  RequireTrackingId,
  RootDefinition,
} from './types';

/**
 * Reserved property holding a functional block's stable, per-instance,
 * cross-branch tracking handle — the anchor a test goal points at. Spread into
 * a block's `properties`: `properties: { ...trackingId(), cta: {...} }`. A block
 * that declares `events` MUST include it (enforced at compile time by
 * {@link defineBlock}). The compile requirement only reserves the slot; the
 * VALUE is enforced at publish by the ab-test plugin's tracking-id guard, so
 * value/uniqueness/drift enforcement is contingent on that plugin being
 * installed (you only need a trackingId value once you actually measure).
 */
export function trackingId(label = 'Tracking ID'): {
  trackingId: { type: 'string'; label: string };
} {
  return { trackingId: { type: 'string', label } };
}

/**
 * Defines a content block with typed properties.
 *
 * @example
 * ```ts
 * const hero = defineBlock({
 *   properties: {
 *     headline: { type: 'string', required: true, label: 'Headline' },
 *   },
 * });
 *
 * // A functional block declares the events it can emit; declaring `events`
 * // requires a `trackingId` property (compile-enforced) — use ...trackingId():
 * const signupForm = defineBlock({
 *   label: 'Signup Form',
 *   properties: {
 *     ...trackingId(),
 *     cta: { type: 'string', required: true, label: 'CTA' },
 *   },
 *   events: {
 *     submit: {},
 *     submitSuccess: {
 *       name: 'generate_lead',
 *       params: { plan: { type: 'string', label: 'Plan' } },
 *     },
 *   },
 * });
 * ```
 */
export function defineBlock<
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

/**
 * Defines the root block for a collection.
 *
 * @example
 * ```ts
 * const pageRoot = defineRoot({
 *   properties: {
 *     title: { type: 'string', required: true, label: 'Page Title' },
 *   },
 * });
 * ```
 */
export function defineRoot<const TProps extends Record<string, BlockProperty>>(
  root: RootDefinition<TProps>,
): RootDefinition<TProps> {
  return root;
}

/**
 * Defines a content collection with a root block and a set of child blocks.
 *
 * @example
 * ```ts
 * const pages = defineCollection({
 *   label: 'Pages',
 *   root: pageRoot,
 *   blocks: { hero, richText },
 * });
 * ```
 */
export function defineCollection<
  const TProps extends Record<string, BlockProperty>,
  const TBlocks extends Record<string, AnyBlockDefinition> = Record<
    string,
    never
  >,
>(
  collection: CollectionDefinition<TProps, TBlocks>,
): CollectionDefinition<TProps, TBlocks> {
  return collection;
}

// ============================================================================
// Compile-time reference validation
// ============================================================================

type ExtractReferencedCollections<
  T extends Record<string, AnyCollectionDefinition>,
> = {
  [K in keyof T]: T[K] extends CollectionDefinition<infer _P, infer TBlocks>
    ? {
        [B in keyof TBlocks]: TBlocks[B] extends BlockDefinition<
          infer BProps,
          any
        >
          ? {
              [F in keyof BProps]: BProps[F] extends {
                type: 'reference';
                collection: infer C;
              }
                ? C
                : never;
            }[keyof BProps]
          : never;
      }[keyof TBlocks]
    : never;
}[keyof T];

type ExtractRootReferencedCollections<
  T extends Record<string, AnyCollectionDefinition>,
> = {
  [K in keyof T]: T[K] extends CollectionDefinition<infer TProps, any>
    ? {
        [F in keyof TProps]: TProps[F] extends {
          type: 'reference';
          collection: infer C;
        }
          ? C
          : never;
      }[keyof TProps]
    : never;
}[keyof T];

type AllReferencedCollections<
  T extends Record<string, AnyCollectionDefinition>,
> = ExtractReferencedCollections<T> | ExtractRootReferencedCollections<T>;

type ValidateCollectionReferences<
  T extends Record<string, AnyCollectionDefinition>,
> =
  AllReferencedCollections<T> extends infer Refs
    ? [Refs] extends [never]
      ? T
      : Refs extends keyof T
        ? T
        : T & {
            __invalid_reference: `Collection '${Refs & string}' does not exist in collections`;
          }
    : T;

/**
 * Groups multiple collection definitions into a single record.
 * The keys become the collection names used throughout the CMS.
 *
 * Reference properties are validated at compile time — if a block property
 * has `type: 'reference'` with a `collection` value that doesn't match any
 * key in the record, TypeScript will report an error.
 *
 * @example
 * ```ts
 * const collections = defineCollections({ pages, posts });
 * ```
 */
export function defineCollections<
  const TCollections extends Record<string, AnyCollectionDefinition>,
>(collections: ValidateCollectionReferences<TCollections>): TCollections {
  return collections as TCollections;
}

/**
 * Identity helper for defining the CMS auth middleware with full type
 * inference. The middleware receives the current request context and
 * must return at least `{ userId }`.
 */
export function defineAuthMiddleware(middleware: CMSMiddleware): CMSMiddleware {
  return middleware;
}
