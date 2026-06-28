import { and, inArray, isNull } from 'drizzle-orm';

import type { BlockTreeNode } from './blocks/reconstruct-snapshot';
import type { CollectionWithName, ResolvedImage } from './types/definitions';
import type { DrizzleInstance } from './types/drizzle';

import { assets } from './db/schema.generated';
import { isInlinedReference } from './links';
import { getImagePropertyNames } from './references';
import { assetScopeConditions } from './scope';

/**
 * Resolves every `image` property in `tree` (in place) from its stored asset id
 * (an `ast_…` string) to a {@link ResolvedImage} — `{ id, slug }` — so the
 * renderer can build the gate URL `/media/asset/{slug}` (status-checked,
 * transformable, SEO-friendly slug) without a second round-trip. The id stays
 * the stored value (this only changes the read output), so usage-tracking and
 * the archive guard are unaffected.
 *
 * Resolution is scoped and liveness-filtered: an id resolves to `{ id, slug }`
 * only when the asset is in the active scope and not archived; otherwise the
 * value becomes `null` (the renderer omits a gone / out-of-scope image), exactly
 * as an internal link resolves to `href: null`. Asset ids in content are
 * author-controlled strings, so the scope gate prevents a forged cross-tenant id
 * from leaking another tenant's slug — symmetric with `resolveLinkPaths`.
 *
 * Runs on the same trees as `resolveLinkPaths`, AFTER references are inlined, so
 * it walks the host tree, descends into inlined references (with the target
 * collection's def), and into children — covering nested image fields.
 */
export async function resolveImageAssets(
  db: DrizzleInstance,
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  allCollections: Record<string, CollectionWithName>,
  scopeColumns: Record<string, unknown> | undefined,
): Promise<void> {
  // 1. Collect every image-prop occurrence; its stored value is the asset id.
  const hits: { props: Record<string, unknown>; key: string; id: string }[] =
    [];
  const ids = new Set<string>();

  const walk = (node: BlockTreeNode, def: CollectionWithName) => {
    for (const key of getImagePropertyNames(def, node.type)) {
      const value = node.properties[key];
      if (typeof value !== 'string' || !value) continue;
      hits.push({ props: node.properties, key, id: value });
      ids.add(value);
    }
    // Descend into INLINED references: their blocks belong to the target
    // collection, so their images resolve with THAT collection's def.
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

  // 2. Batch-resolve id -> slug for in-scope, non-archived assets.
  const rows = await db
    .select({ id: assets.id, slug: assets.slug })
    .from(assets)
    .where(
      and(
        inArray(assets.id, [...ids]),
        isNull(assets.archivedAt),
        ...assetScopeConditions(scopeColumns),
      ),
    );
  const slugById = new Map(rows.map((r) => [r.id, r.slug]));

  // 3. Replace each image value in place: { id, slug } when live + in scope,
  //    else null (gone / out of scope — the renderer omits it).
  for (const { props, key, id } of hits) {
    const slug = slugById.get(id);
    const resolved: ResolvedImage = slug ? { id, slug } : null;
    props[key] = resolved;
  }
}
