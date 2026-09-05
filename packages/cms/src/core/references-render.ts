import { and, asc, eq, inArray } from 'drizzle-orm';

import type {
  AbTestResolver,
  CollectionWithName,
  PublishedBranchSnapshot,
  ReferenceResolver,
  ResolvedReference,
  RunningAbTest,
} from './types';
import type { DrizzleInstance } from './types/drizzle';

import {
  assembleBlockTree,
  loadBlocksAtCommit,
  type BlockTreeNode,
} from './blocks/reconstruct-snapshot';
import { branches, publications, roots } from './db/schema.generated';
import { CMSError } from './errors';
import { resolveLinkPaths } from './links';
import { getReferencePropertyNames } from './references';
import { rootScopeConditions } from './scope';
import { substituteVariables } from './variables';

// Reference resolution

function collectReferenceRootIds(
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  function walk(node: BlockTreeNode) {
    const refProps = getReferencePropertyNames(collectionDef, node.type);
    for (const [propName, targetCollection] of refProps) {
      const raw = node.properties[propName];
      // Single reference (string) or list-of-reference (array of strings).
      const values = Array.isArray(raw) ? raw : [raw];
      for (const value of values) {
        if (typeof value !== 'string' || !value) continue;
        if (!result.has(targetCollection)) {
          result.set(targetCollection, new Set());
        }
        result.get(targetCollection)!.add(value);
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree);
  return result;
}

function replaceReferencesInTree(
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  resolvedMap: Map<string, ResolvedReference>,
) {
  function walk(node: BlockTreeNode) {
    const refProps = getReferencePropertyNames(collectionDef, node.type);
    for (const [propName, _targetCollection] of refProps) {
      const value = node.properties[propName];
      if (Array.isArray(value)) {
        // list-of-reference: resolve each element, leaving unresolved ids as-is
        // (matches the scalar fallback below).
        (node.properties as Record<string, unknown>)[propName] = value.map(
          (v) => (typeof v === 'string' ? (resolvedMap.get(v) ?? v) : v),
        );
      } else if (typeof value === 'string') {
        const resolved = resolvedMap.get(value);
        if (resolved) {
          (node.properties as Record<string, unknown>)[propName] = resolved;
        }
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(tree);
}

type LoadedRoot = {
  rootId: string;
  commitId: string;
  properties: Record<string, unknown>;
  tree: BlockTreeNode;
  /**
   * Set when this root has a running A/B test: top-level `tree`/`properties`
   * are the CONTROL branch, and `abTest.variants` carries the published
   * NON-CONTROL variant branches for the client to pick. The control is NOT
   * re-listed in `variants` — it is already the top-level tree, so embedding it
   * there would serialize the control subtree twice per reference.
   */
  abTest?: {
    testId: string;
    trafficPercentage: number;
    variants: PublishedBranchSnapshot[];
  };
};

async function loadPublishedRoots(
  db: DrizzleInstance,
  collectionName: string,
  rootIds: string[],
  scopeColumns?: Record<string, unknown>,
  abTestResolver?: AbTestResolver,
): Promise<Map<string, LoadedRoot>> {
  const result = new Map<string, LoadedRoot>();

  if (rootIds.length === 0) return result;

  const pubRows = await db
    .select({
      rootId: publications.rootId,
      branchId: publications.branchId,
      headCommitId: branches.headCommitId,
    })
    .from(publications)
    .innerJoin(branches, eq(branches.id, publications.branchId))
    .innerJoin(roots, eq(roots.id, publications.rootId))
    .where(
      and(
        inArray(publications.rootId, rootIds),
        eq(roots.collection, collectionName),
        // Defensive scoping: a referenced root must be in the active scope. The
        // caller passes CROSS-scope columns (the plugin's cross-scope columns
        // already removed — e.g. language), so a sibling in another such scope
        // still loads (the caller already resolved a specific one).
        ...rootScopeConditions(scopeColumns),
      ),
    )
    // A referenced root with several live branches (parallel-live / A/B) yields
    // several publication rows. Order deterministically (oldest publish first,
    // branchId as the stable tiebreak) so the single pick below is stable across
    // requests instead of DB-order-undefined.
    .orderBy(asc(publications.publishedAt), asc(publications.branchId));

  // Group publication rows per root, preserving the deterministic ORDER BY order.
  const pubsByRoot = new Map<
    string,
    { branchId: string; commitId: string }[]
  >();
  for (const row of pubRows) {
    const entry = { branchId: row.branchId, commitId: row.headCommitId };
    const list = pubsByRoot.get(row.rootId);
    if (list) list.push(entry);
    else pubsByRoot.set(row.rootId, [entry]);
  }

  // Which referenced roots have a running A/B test. No resolver (no ab-test
  // plugin) means an empty map, and every root takes the deterministic single
  // pick below.
  const running = abTestResolver
    ? await abTestResolver.runningTests(db, scopeColumns, rootIds)
    : new Map<string, RunningAbTest>();

  /** Load + assemble one branch's published tree; null if it has no content. */
  const loadBranch = async (
    rootId: string,
    commitId: string,
  ): Promise<BlockTreeNode | null> => {
    const { blocks } = await loadBlocksAtCommit(db, commitId, rootId);
    // This feeds public rendered output (embedded references + A/B variants),
    // so strip the reserved `__slug` draft key.
    return assembleBlockTree(blocks, rootId, { stripReservedProps: true });
  };

  await Promise.all(
    [...pubsByRoot.entries()].map(async ([rootId, pubs]) => {
      const test = running.get(rootId);

      // Default (and fallback): the deterministic single pick — the first row
      // in the ORDER BY. Used for every non-varying embed.
      const single = async () => {
        const first = pubs[0];
        if (!first) return;
        const tree = await loadBranch(rootId, first.commitId);
        if (!tree) return;
        result.set(rootId, {
          rootId,
          commitId: first.commitId,
          properties: tree.properties,
          tree,
        });
      };

      if (!test) return single();

      // Running test: fan out and load the published tree of every variant
      // branch. The control fills top-level tree/properties; the NON-CONTROL
      // branches go into `variants` (the control is deliberately NOT
      // re-embedded there, see LoadedRoot.abTest / PublishedBranchSnapshot, to
      // avoid serializing the control subtree twice per reference).
      const commitByBranch = new Map(pubs.map((p) => [p.branchId, p.commitId]));
      const variants: PublishedBranchSnapshot[] = [];
      let control:
        | { properties: Record<string, unknown>; tree: BlockTreeNode }
        | undefined;
      let controlCommitId: string | undefined;
      for (const v of test.variants) {
        const commitId = commitByBranch.get(v.branchId);
        if (!commitId) continue; // a declared variant that isn't published → skip
        const tree = await loadBranch(rootId, commitId);
        if (!tree) continue;
        if (v.isControl) {
          control = { properties: tree.properties, tree };
          controlCommitId = commitId;
        } else {
          variants.push({
            branchId: v.branchId,
            properties: tree.properties,
            tree,
          });
        }
      }

      // The control branch fills top-level tree/properties (the no-JS / AB-off
      // fallback, and what `isResolvedReference` narrows on). Fanning out needs
      // the control PLUS at least one published non-control variant (two or
      // more branches total); otherwise degrade to the deterministic single
      // pick (no fan-out) so top-level stays populated.
      if (!control || !controlCommitId || variants.length < 1) {
        return single();
      }

      result.set(rootId, {
        rootId,
        commitId: controlCommitId,
        properties: control.properties,
        tree: control.tree,
        abTest: {
          testId: test.testId,
          trafficPercentage: test.trafficPercentage,
          variants,
        },
      });
    }),
  );

  return result;
}

// References can nest (a reusable block embeds another), and the `visited` set
// only stops CYCLES — a long ACYCLIC chain of distinct references would still
// recurse unbounded and blow the call stack. Cap the depth and fail loud on what
// is almost certainly a misconfiguration (legitimate nesting is a handful deep).
const MAX_REFERENCE_DEPTH = 20;

export async function resolveTreeReferences(
  db: DrizzleInstance,
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  allCollections: Record<string, CollectionWithName>,
  resolver: ReferenceResolver,
  scopeColumns: Record<string, unknown> | undefined,
  visited: Set<string> = new Set(),
  depth = 0,
  abTestResolver?: AbTestResolver,
): Promise<void> {
  if (depth > MAX_REFERENCE_DEPTH) {
    throw new CMSError('REFERENCE_DEPTH_EXCEEDED');
  }
  const refValues = collectReferenceRootIds(tree, collectionDef);
  if (refValues.size === 0) return;

  // Keyed by the STORED reference value (a rootId OR, under i18n, a translationKey)
  // so replaceReferencesInTree can look it up by what's actually in the block.
  const resolvedMap = new Map<string, ResolvedReference>();

  // INTENTIONALLY SERIAL, do NOT turn this (or the inner `valueToRootId` loop)
  // into a Promise.all. Both awaits mutate the SHARED `visited` cycle-guard Set
  // (added to here, and extended by the recursive descent below), which both
  // de-dupes references that appear more than once across sibling subtrees AND
  // prevents infinite recursion on reference cycles. Running the iterations
  // concurrently would race that Set: two branches could each load the same
  // sub-reference before either records it in `visited`, re-doing work and, on
  // a cycle, recursing until MAX_REFERENCE_DEPTH throws. The serial loop lets
  // each iteration observe the prior iterations' `visited` writes.
  for (const [targetCollectionName, valueSet] of refValues) {
    const targetDef = allCollections[targetCollectionName];
    if (!targetDef) continue;

    // Resolve each stored reference value to the single rootId it RENDERS as,
    // via the scope's reference resolver: identity (value to value) without a
    // plugin; i18n translation-group resolution (tgr_ to best sibling along
    // the fallback chain; rot_ to active-language sibling of its group, else
    // the stored anchor) when the i18n plugin provides one. The resolution
    // policy + any tenant scoping live in the resolver; core only threads it
    // through the recursion so nested references resolve in the same scope.
    const valueToRootId = await resolver.resolveRenderTargets(
      db,
      scopeColumns,
      targetCollectionName,
      [...valueSet],
    );

    const targetRootIds = [...new Set(valueToRootId.values())];
    const unvisitedIds = targetRootIds.filter((id) => !visited.has(id));
    for (const id of unvisitedIds) visited.add(id);

    const loaded = await loadPublishedRoots(
      db,
      targetCollectionName,
      unvisitedIds,
      scopeColumns,
      abTestResolver,
    );

    for (const [storedValue, rootId] of valueToRootId) {
      const data = loaded.get(rootId);
      if (!data) continue; // unresolved / already-visited (cycle guard)

      // Snapshot the cycle-guard state BEFORE resolving this block's branches:
      // each A/B variant is an alternate rendering of the SAME block and
      // almost always re-embeds the same sub-references as the control. The
      // shared `visited` set (which the control recursion below extends) would
      // treat those as already-loaded and leave them UNRESOLVED in the variant
      // copies, so each variant resolves against its own clone of this
      // pre-control state. XOR guarantees at most one varying root per render,
      // so this clones for at most one block per page. Non-A/B refs keep the
      // shared-`visited` path.
      const branchVisited = data.abTest ? new Set(visited) : null;

      await resolveTreeReferences(
        db,
        data.tree,
        targetDef,
        allCollections,
        resolver,
        scopeColumns,
        visited,
        depth + 1,
        abTestResolver,
      );

      if (data.abTest && branchVisited) {
        // `variants` holds only the NON-CONTROL branches (the control IS
        // data.tree, already resolved above), so every entry here is a
        // distinct variant subtree that needs its own reference resolution.
        for (const variant of data.abTest.variants) {
          await resolveTreeReferences(
            db,
            variant.tree,
            targetDef,
            allCollections,
            resolver,
            scopeColumns,
            new Set(branchVisited),
            depth + 1,
            abTestResolver,
          );
        }
      }

      const entry: ResolvedReference = {
        rootId,
        collection: targetCollectionName,
        properties: data.properties,
        tree: data.tree,
      };
      if (data.abTest) entry.abTest = data.abTest;
      resolvedMap.set(storedValue, entry);
    }
  }

  replaceReferencesInTree(tree, collectionDef, resolvedMap);
}

/**
 * Builds a sidecar map of PUBLISHED previews for every reference embedded in
 * `tree`, keyed by the STORED reference value (rootId / `tgr_`). Each preview is
 * the referenced root's published render tree in the active scope — its own
 * nested references resolved and `{{variables}}` substituted, exactly like
 * getPublishedContent. References that are not published (or out of scope) are
 * omitted. This lets getBlockTree return the raw editable tree PLUS all reference
 * previews in ONE call instead of N getPublishedContent round-trips, while
 * reusing the same resolution machinery (no duplication).
 */
export async function buildReferencePreviews(
  db: DrizzleInstance,
  tree: BlockTreeNode,
  collectionDef: CollectionWithName,
  allCollections: Record<string, CollectionWithName>,
  resolver: ReferenceResolver,
  scopeColumns: Record<string, unknown> | undefined,
  vars: Map<string, string>,
  abTestResolver?: AbTestResolver,
): Promise<Record<string, BlockTreeNode>> {
  const previews: Record<string, BlockTreeNode> = {};
  const refsByCollection = collectReferenceRootIds(tree, collectionDef);

  for (const [targetCollectionName, valueSet] of refsByCollection) {
    const targetDef = allCollections[targetCollectionName];
    if (!targetDef) continue;

    const valueToRootId = await resolver.resolveRenderTargets(
      db,
      scopeColumns,
      targetCollectionName,
      [...valueSet],
    );
    const loaded = await loadPublishedRoots(
      db,
      targetCollectionName,
      [...new Set(valueToRootId.values())],
      scopeColumns,
      abTestResolver,
    );

    for (const [storedValue, rootId] of valueToRootId) {
      const data = loaded.get(rootId);
      if (!data) continue; // not published / out of scope — omit from the sidecar

      // Fully render the preview: resolve its own nested references, then vars.
      await resolveTreeReferences(
        db,
        data.tree,
        targetDef,
        allCollections,
        resolver,
        scopeColumns,
        new Set([rootId]),
        1,
        abTestResolver,
      );
      substituteVariables(data.tree, vars);
      // Resolve links and image assets in the preview, exactly like
      // getPublishedContent renders the same tree.
      await resolveLinkPaths(
        db,
        data.tree,
        targetDef,
        allCollections,
        resolver,
        scopeColumns,
      );
      previews[storedValue] = data.tree;
    }
  }

  return previews;
}
