import { and } from 'drizzle-orm';

import type { BlockTreeNode } from './blocks/reconstruct-snapshot';
import type { RichTextNode } from './rich-text/types';
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
import { isRichTextDoc } from './rich-text/schema';
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
type InlinedReference = {
  collection: string;
  tree: BlockTreeNode;
  abTest?: { variants: { tree: BlockTreeNode }[] };
};
function isInlinedReference(value: unknown): value is InlinedReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'tree' in value &&
    'collection' in value &&
    'rootId' in value
  );
}

/** The keys of `richText` properties (single or list) of `blockType`. */
function getRichTextPropertyNames(
  collectionDef: CollectionWithName,
  blockType: string,
): string[] {
  const props =
    blockType === collectionDef.name || blockType === 'root'
      ? collectionDef.root.properties
      : collectionDef.blocks?.[blockType]?.properties;
  if (!props) return [];
  return Object.entries(props)
    .filter(
      ([, spec]) =>
        spec.type === 'richText' ||
        (spec.type === 'list' && spec.of.type === 'richText'),
    )
    .map(([key]) => key);
}

/** The attrs of every `link` mark with a `{ link: LinkValue }` target. */
function richTextLinkMarks(
  nodes: readonly RichTextNode[] | undefined,
  out: Record<string, unknown>[],
): Record<string, unknown>[] {
  for (const node of nodes ?? []) {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link' && isLinkValue(mark.attrs?.link)) {
        out.push(mark.attrs as Record<string, unknown>);
      }
    }
    richTextLinkMarks(node.content, out);
  }
  return out;
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
 * Link marks inside `richText` values (also in lists) resolve the same way:
 * a mark with `attrs.link` gets `attrs.resolved = { href }` (`href: null`
 * for a gone target, so the renderer drops the link). Like `link`
 * properties, they do not guard their target against deletion.
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
  // Collect every link occurrence; group internal targets by collection.
  const hits: {
    props: Record<string, unknown>;
    key: string;
    value: LinkValue;
  }[] = [];
  const markHits: { attrs: Record<string, unknown>; value: LinkValue }[] = [];
  const noteInternal = (value: LinkValue) => {
    if (value.kind !== 'internal') return;
    const set = internalByCollection.get(value.collection) ?? new Set();
    set.add(value.rootId);
    internalByCollection.set(value.collection, set);
  };
  const internalByCollection = new Map<string, Set<string>>();

  const walk = (node: BlockTreeNode, def: CollectionWithName) => {
    for (const key of getLinkPropertyNames(def, node.type)) {
      const value = node.properties[key];
      if (!isLinkValue(value)) continue;
      hits.push({ props: node.properties, key, value });
      noteInternal(value);
    }
    for (const key of getRichTextPropertyNames(def, node.type)) {
      const raw = node.properties[key];
      if (raw === undefined || raw === null) continue;
      // Resolution writes into the marks: work on this read's own copy.
      const copy: unknown = structuredClone(raw);
      node.properties[key] = copy;
      const docs: unknown[] = Array.isArray(copy) ? copy : [copy];
      for (const doc of docs) {
        if (!isRichTextDoc(doc)) continue;
        for (const attrs of richTextLinkMarks(doc.content, [])) {
          const value = attrs.link as LinkValue;
          markHits.push({ attrs, value });
          noteInternal(value);
        }
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

  if (hits.length === 0 && markHits.length === 0) return;

  // Defensive scope gate at the path layer too (symmetric with redirects): even
  // though the resolver returns only in-scope targets, a misconfigured or
  // identity resolver must not leak an out-of-scope (e.g. cross-tenant)
  // target's path.
  const tenantConds = rootScopeConditions(scopeColumns);
  const rootScope: TableScope | undefined = scopeColumns
    ? {
        where: tenantConds.length ? and(...tenantConds) : undefined,
        insertColumns: scopeColumns,
      }
    : undefined;

  // Resolve internal targets: stored rootId to active-language sibling to path.
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
    const entries = [...valueToRootId];
    const paths = await Promise.all(
      entries.map(
        ([, targetRootId]): Promise<string | null> =>
          slug?.enabled
            ? resolveRootCurrentPath(
                db,
                slug as EnabledSlug,
                targetRootId,
                rootScope,
              )
            : Promise.resolve(null),
      ),
    );
    entries.forEach(([storedRootId, targetRootId], i) => {
      resolved.set(`${collection}:${storedRootId}`, {
        targetRootId,
        path: paths[i] ?? null,
      });
    });
  }

  // Replace each link value in place.
  for (const { props, key, value } of hits) {
    props[key] = resolveOne(value, resolved);
  }
  for (const { attrs, value } of markHits) {
    attrs.resolved = { href: resolveOne(value, resolved).href };
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
      const link: Extract<ResolvedLink, { kind: 'internal' }> = {
        kind: 'internal',
        targetRootId: hit?.targetRootId ?? value.rootId,
        collection: value.collection,
        href,
      };
      if (value.fragment) link.fragment = value.fragment;
      if (value.query) link.query = value.query;
      return link;
    }
  }
}
