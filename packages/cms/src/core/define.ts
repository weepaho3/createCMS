import type { AnyColumn } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

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
import type { CMSUserConfig } from './types/definitions';
import type { CMSPlugin } from './types/plugin';

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
 * Blocks may be referenced (`blocks: { hero }`) or written inline
 * (`blocks: { hero: { label, properties } }`). For the inline form the `blocks`
 * parameter is shaped as `{ [K in keyof TBlocks]: AnyBlockDefinition } & TBlocks`
 * — the mapped half gives each block value the concrete `BlockDefinition`
 * contextual type so editors autocomplete its fields (`label`, `properties`,
 * `events`, …) instead of falling back to globals, while the `& TBlocks` half
 * keeps inferring each block's specific shape (so the typed create/update API
 * and `structure` autocomplete still see the exact block keys and properties).
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
  collection: Omit<CollectionDefinition<TProps, TBlocks>, 'blocks'> & {
    blocks?: { [K in keyof TBlocks]: AnyBlockDefinition } & TBlocks;
  },
): CollectionDefinition<TProps, TBlocks> {
  return collection as CollectionDefinition<TProps, TBlocks>;
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

/**
 * Identity helper for authoring a plugin. Preserves the literal `id` (so it
 * becomes the `cms.api.<id>` namespace key, not a `string` index signature) and
 * the exact `endpoints` record, while still type-checking the object against
 * {@link CMSPlugin}. The `const` type-param modifier is what keeps `id` a
 * literal — without it, generic inference widens `id: 'myPlugin'` back to
 * `string` and the helper is pointless.
 *
 * Strictly safer than the `{ ... } satisfies CMSPlugin` pattern it replaces:
 * `satisfies` rejects typo'd fields but WIDENS `id` to `string`; this helper
 * keeps `id` literal AND rejects unknown top-level keys (via the `never`-mapped
 * excess-key guard).
 *
 * @example
 * ```ts
 * const myPlugin = definePlugin({
 *   id: 'myPlugin',
 *   endpoints: { ... },
 *   hooks: { before: [...], after: [...] },
 *   async init(ctx) { return { context: { myService } }; },
 * });
 * ```
 */
export function definePlugin<const T extends CMSPlugin>(
  plugin: T & Record<Exclude<keyof T, keyof CMSPlugin>, never>,
): T {
  return plugin;
}

/**
 * Identity helper for the CMS `user` relation config. Infers the user table
 * from `config.table` so `exposeColumns` is checked against the table's real
 * columns — a typo is a compile error, not a value silently dropped by the
 * runtime allowlist filter. The authoring surface (`CMSDefinition.user`) uses
 * the defaulted `CMSUserConfig<AnyPgTable>`, which widens `exposeColumns` to
 * `string[]`; this helper restores per-table inference.
 *
 * NOTE the return type is the STRUCTURAL shape of `CMSUserConfig<TTable>`, not
 * the named alias. `CMSUserConfig<T>` is invariant in `T` (the type param
 * appears both covariantly in `table` and contravariantly via
 * `keyof T['$inferSelect']`), so a value typed `CMSUserConfig<userTable>` will
 * NOT assign to the `CMSUserConfig<AnyPgTable>` slot on `createCMS`. Returning
 * the anonymous shape makes the result behave like an inline literal — it
 * assigns to that slot AND still lets `createCMS` recover the concrete table via
 * its `user: CMSUserConfig<infer U>` inference (so `withUser`/`actorUser` stay
 * typed).
 */
export function defineUserConfig<const TTable extends AnyPgTable>(
  config: CMSUserConfig<TTable>,
): {
  table: TTable;
  idColumn: AnyColumn;
  exposeColumns: (keyof TTable['$inferSelect'] & string)[];
} {
  return config;
}
