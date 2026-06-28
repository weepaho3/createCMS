import { and } from 'drizzle-orm';

import type { BlockTreeNode } from './blocks/reconstruct-snapshot';
import type {
  CollectionWithName,
  LinkValue,
  ReferenceResolver,
  ResolvedLink,
  ResolvedSlugConfig,
  TableScope,
} from './types/definitions';
import type { DrizzleInstance } from './types/drizzle';

import { resolveRootCurrentPath } from './redirects/resolve';
import { getLinkPropertyNames } from './references';
import { rootScopeConditions } from './scope';

type EnabledSlug = Extract<ResolvedSlugConfig, { enabled: true }>;

function isLinkValue(value: unknown): value is LinkValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

/** A `reference` property resolved to an inlined target (carries its own tree). */
export type InlinedReference = {
  collection: string;
  tree: BlockTreeNode;
  abTest?: { variants: { tree: BlockTreeNode }[] };
};
export function isInlinedReference(value: unknown): value is InlinedReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tree' in value &&
    'collection' in value &&
    'rootId' in value
  );
}

function withSuffix(path: string, fragment?: string, query?: string): string {
  return `${path}${query ? `?${query}` : ''}${fragment ? `#${fragment}` : ''}`;
}

/**
 * Resolves every `link` property in `tree` (in place) from its stored
 * {@link LinkValue} to a {@link ResolvedLink} (an `href` for the renderer).
 *
 * An `internal` link is a LANGUAGE-AWARE reference: its stored target is mapped
 * to the active-language sibling via the scope's reference resolver, then to that
 * root's CURRENT path via `resolveRootCurrentPath` (the same resolver redirects
 * use). It resolves to `href: null` when the target is gone / out of scope / its
 * collection has no slug — the renderer disables the link. External / email /
 * phone are static pass-throughs. Unlike references, NOTHING is embedded.
 *
 * Runs on the host-collection tree (the common case: link fields on page blocks);
 * it walks the whole tree, so nested host blocks are covered.
 */
export async function resolveLinkPaths(
  db: DrizzleInstance,
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  allCollections: Record<string, CollectionWithName>,
  resolver: ReferenceResolver,
  scopeColumns: Record<string, unknown> | undefined,
): Promise<void> {
  // 1. Collect every link occurrence; group internal targets by collection.
  const hits: {
    props: Record<string, unknown>;
    key: string;
    value: LinkValue;
  }[] = [];
  const internalByCollection = new Map<string, Set<string>>();

  const walk = (node: BlockTreeNode, def: CollectionWithName) => {
    for (const key of getLinkPropertyNames(def, node.type)) {
      const value = node.properties[key];
      if (!isLinkValue(value)) continue;
      hits.push({ props: node.properties, key, value });
      if (value.kind === 'internal') {
        const set = internalByCollection.get(value.collection) ?? new Set();
        set.add(value.rootId);
        internalByCollection.set(value.collection, set);
      }
    }
    // Descend into INLINED references (getPublishedContent inlines reusable
    // blocks): their blocks belong to the target collection, so their links
    // resolve with THAT collection's def, not the host's.
    for (const value of Object.values(node.properties)) {
      if (!isInlinedReference(value)) continue;
      const refDef = allCollections[value.collection];
      if (!refDef) continue;
      if (value.tree) walk(value.tree, refDef);
      for (const variant of value.abTest?.variants ?? []) {
        if (variant.tree) walk(variant.tree, refDef);
      }
    }
    for (const child of node.children ?? []) walk(child, def);
  };
  walk(tree, collectionDef);

  if (hits.length === 0) return;

  // Defensive scope gate at the path layer too (symmetric with redirects): even
  // though the resolver returns only in-scope targets, a misconfigured / identity
  // resolver must not leak an out-of-scope (e.g. cross-tenant) target's path.
  const tenantConds = rootScopeConditions(scopeColumns);
  const rootScope: TableScope | undefined = scopeColumns
    ? {
        where: tenantConds.length ? and(...tenantConds) : undefined,
        insertColumns: scopeColumns,
      }
    : undefined;

  // 2. Resolve internal targets: stored rootId -> active-language sibling -> path.
  const resolved = new Map<
    string,
    { targetRootId: string; path: string | null }
  >();
  for (const [collection, rootIds] of internalByCollection) {
    const slug = allCollections[collection]?.slug as
      | ResolvedSlugConfig
      | undefined;
    const valueToRootId = await resolver.resolveRenderTargets(
      db,
      scopeColumns,
      collection,
      [...rootIds],
    );
    for (const [storedRootId, targetRootId] of valueToRootId) {
      const path = slug?.enabled
        ? await resolveRootCurrentPath(
            db,
            slug as EnabledSlug,
            targetRootId,
            rootScope,
          )
        : null;
      resolved.set(`${collection}:${storedRootId}`, { targetRootId, path });
    }
  }

  // 3. Replace each link value in place.
  for (const { props, key, value } of hits) {
    props[key] = resolveOne(value, resolved);
  }
}

function resolveOne(
  value: LinkValue,
  resolved: Map<string, { targetRootId: string; path: string | null }>,
): ResolvedLink {
  switch (value.kind) {
    case 'external':
      return { kind: 'external', href: value.url };
    case 'email':
      return { kind: 'email', href: `mailto:${value.email}` };
    case 'phone':
      return { kind: 'phone', href: `tel:${value.phone}` };
    case 'internal': {
      const hit = resolved.get(`${value.collection}:${value.rootId}`);
      const href =
        hit?.path != null
          ? withSuffix(hit.path, value.fragment, value.query)
          : null;
      return {
        kind: 'internal',
        targetRootId: hit?.targetRootId ?? value.rootId,
        collection: value.collection,
        href,
        ...(value.fragment ? { fragment: value.fragment } : {}),
        ...(value.query ? { query: value.query } : {}),
      };
    }
  }
}
