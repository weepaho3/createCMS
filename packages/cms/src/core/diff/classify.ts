import type { ReconstructedBlock } from '../blocks/reconstruct-snapshot';
import type {
  BlockChange,
  ChangeType,
  DiffSummary,
  MovedInfo,
  PropertyChange,
} from './types';

import { readRootSlug, ROOT_SLUG_PROP } from '../blocks/reconstruct-snapshot';
import { diffProperties } from './property-diff';
import { diffRichText } from './text-diff';

// ============================================================================
// Identity-based change classification
//
// Classifies the base → source delta of one root into the flat `BlockChange`
// list. Unlike a positional comparison, movement is identity-based: a block is
// `moved` only when it was reparented or is a true reorder outlier among the
// surviving common siblings (LIS-based), and a parent is `childrenReordered`
// only when the RELATIVE order of its surviving common children changed.
// Insertions and deletions around untouched siblings therefore produce no
// cascade — only the added/deleted block itself gets an entry.
// ============================================================================

// ============================================================================
// Types
// ============================================================================

/**
 * The property-spec shape the classifier needs from a collection definition:
 * just enough to recognize `richText` properties and `list`-of-`richText`
 * items. Callers pass their full definition objects, which are structural
 * supersets of this.
 */
export type DiffPropertySpec = { type: string; of?: { type: string } };

type ParentInfo = { parentId: string; index: number };

// ============================================================================
// Snapshot helpers
// ============================================================================

/** True when the block exists in the snapshot and is not a tombstone. */
function isAlive(block: ReconstructedBlock | undefined): block is ReconstructedBlock {
  return block !== undefined && !block.deleted;
}

/**
 * The parent's `children` filtered to blocks alive in the same snapshot —
 * the index space used for every `fromIndex` / `toIndex` in the diff.
 * Duplicate child references (corrupted snapshots) collapse to their first
 * occurrence, keeping the sequence distinct as {@link lisPositions} requires.
 */
function aliveChildren(
  blocks: Map<string, ReconstructedBlock>,
  parent: ReconstructedBlock,
): string[] {
  const seen = new Set<string>();
  return parent.children.filter((childId) => {
    if (seen.has(childId)) return false;
    seen.add(childId);
    return isAlive(blocks.get(childId));
  });
}

/**
 * Maps each alive block to its alive parent and its index among that parent's
 * alive children. Blocks nobody references (the root) are absent.
 */
function buildParentIndex(
  blocks: Map<string, ReconstructedBlock>,
): Map<string, ParentInfo> {
  const parentOf = new Map<string, ParentInfo>();
  for (const [, block] of blocks) {
    if (block.deleted) continue;
    aliveChildren(blocks, block).forEach((childId, index) => {
      if (!parentOf.has(childId)) {
        parentOf.set(childId, { parentId: block.blockId, index });
      }
    });
  }
  return parentOf;
}

/** `properties` with the reserved draft-slug key removed (non-mutating). */
function withoutSlug(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  if (!(ROOT_SLUG_PROP in properties)) return properties;
  const { [ROOT_SLUG_PROP]: _omit, ...rest } = properties;
  return rest;
}

// ============================================================================
// Rich-text spec lookup
// ============================================================================

/**
 * Builds the `isRichText` predicate for one block from its property specs:
 * a top-level key whose spec is `richText`, or a `[key, index]` path whose
 * spec is a `list` of `richText` items.
 */
function makeIsRichText(
  specs: Record<string, DiffPropertySpec> | undefined,
): (path: (string | number)[]) => boolean {
  return (path) => {
    if (!specs) return false;
    if (path.length === 1 && typeof path[0] === 'string') {
      return specs[path[0]]?.type === 'richText';
    }
    if (
      path.length === 2 &&
      typeof path[0] === 'string' &&
      typeof path[1] === 'number'
    ) {
      const spec = specs[path[0]];
      return spec?.type === 'list' && spec.of?.type === 'richText';
    }
    return false;
  };
}

// ============================================================================
// Reorder detection (LIS)
// ============================================================================

/**
 * Positions (into `seq`) of the longest strictly increasing subsequence of a
 * sequence of distinct numbers, via the standard O(n log n) patience/tails
 * algorithm. Tie-break for determinism: at every length the smallest possible
 * tail value is kept, so the reconstructed subsequence is the
 * lexicographically earliest (by value) among all maximal ones — e.g. for
 * `[1, 0, 2]` it picks `[0, 2]`, not `[1, 2]`.
 */
function lisPositions(seq: number[]): Set<number> {
  const tails: number[] = []; // tails[k] = position of the smallest tail of a length-(k+1) subsequence
  const prev = new Array<number>(seq.length).fill(-1);

  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1;
    tails[lo] = i;
  }

  const positions = new Set<number>();
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor !== -1) {
    positions.add(cursor);
    cursor = prev[cursor];
  }
  return positions;
}

/**
 * Per parent alive in both snapshots, detects whether the RELATIVE order of
 * its surviving common children changed, and if so which children actually
 * moved: the common children (alive AND under this parent on both sides) are
 * taken in SOURCE order and their BASE indices form a sequence — strictly
 * increasing means only insertions/removals happened (no entry at all);
 * otherwise the LIS members stayed put and every outlier is a real
 * `reordered` move.
 */
function detectReorders(opts: {
  baseBlocks: Map<string, ReconstructedBlock>;
  sourceBlocks: Map<string, ReconstructedBlock>;
  baseParentOf: Map<string, ParentInfo>;
  sourceParentOf: Map<string, ParentInfo>;
}): { reorderedParents: Set<string>; movedByBlockId: Map<string, MovedInfo> } {
  const { baseBlocks, sourceBlocks, baseParentOf, sourceParentOf } = opts;

  const reorderedParents = new Set<string>();
  const movedByBlockId = new Map<string, MovedInfo>();

  for (const [parentId, sourceParent] of sourceBlocks) {
    if (sourceParent.deleted) continue;
    const baseParent = baseBlocks.get(parentId);
    if (!isAlive(baseParent)) continue;

    const commonChildren = aliveChildren(sourceBlocks, sourceParent).filter(
      (childId) =>
        isAlive(baseBlocks.get(childId)) &&
        baseParentOf.get(childId)?.parentId === parentId,
    );

    const baseIndices = commonChildren.map(
      (childId) => baseParentOf.get(childId)!.index,
    );

    const stayed = lisPositions(baseIndices);
    if (stayed.size === baseIndices.length) continue;

    reorderedParents.add(parentId);
    commonChildren.forEach((childId, position) => {
      if (stayed.has(position)) return;
      movedByBlockId.set(childId, {
        kind: 'reordered',
        fromParentId: parentId,
        fromIndex: baseParentOf.get(childId)!.index,
        toParentId: parentId,
        toIndex: sourceParentOf.get(childId)!.index,
      });
    });
  }

  return { reorderedParents, movedByBlockId };
}

// ============================================================================
// classifyChanges
// ============================================================================

/**
 * Classifies the base → source delta of one root into the flat change list
 * plus the per-changeType summary.
 *
 * - `added` / `deleted`: alive on exactly one side.
 * - `modified`: type changed or properties deep-unequal — with the reserved
 *   `__slug` key stripped from BOTH sides for the root block, so a slug-only
 *   change never counts as modified. Modified entries carry `propertyChanges`
 *   (rich-text properties get word-level `textDiff` segments per the property
 *   specs) and `typeChange` when the type differs.
 * - `moved` / `childrenReordered`: identity-based, see {@link detectReorders}.
 *   A reparented block additionally carries its old/new parent and index
 *   (among the respective parent's alive children).
 * - `slugChange` (root entry only): set when the draft slug differs. A
 *   slug-only change produces an entry whose `changeTypes` is empty except
 *   for other detected changes — consumers check `slugChange` explicitly, and
 *   `summary.modified` counts only true property/type modifications.
 *
 * The root block's stored `type` is the collection name (not the logical
 * `'root'`); entries carry versions exactly as stored, without cloning.
 */
export function classifyChanges(opts: {
  baseBlocks: Map<string, ReconstructedBlock>;
  sourceBlocks: Map<string, ReconstructedBlock>;
  targetBlocks: Map<string, ReconstructedBlock>;
  rootId: string;
  blockDefs: Record<string, { properties?: Record<string, DiffPropertySpec> }>;
  rootProperties: Record<string, DiffPropertySpec>;
}): { changes: BlockChange[]; summary: DiffSummary } {
  const {
    baseBlocks,
    sourceBlocks,
    targetBlocks,
    rootId,
    blockDefs,
    rootProperties,
  } = opts;

  const baseParentOf = buildParentIndex(baseBlocks);
  const sourceParentOf = buildParentIndex(sourceBlocks);

  const { reorderedParents, movedByBlockId } = detectReorders({
    baseBlocks,
    sourceBlocks,
    baseParentOf,
    sourceParentOf,
  });

  const allBlockIds = new Set<string>();
  for (const id of baseBlocks.keys()) allBlockIds.add(id);
  for (const id of sourceBlocks.keys()) allBlockIds.add(id);

  const changes: BlockChange[] = [];
  const summary: DiffSummary = {
    added: 0,
    deleted: 0,
    modified: 0,
    moved: 0,
    reordered: 0,
  };

  for (const blockId of allBlockIds) {
    const base = baseBlocks.get(blockId);
    const source = sourceBlocks.get(blockId);
    const baseAlive = isAlive(base);
    const sourceAlive = isAlive(source);

    const changeTypes: ChangeType[] = [];
    let propertyChanges: PropertyChange[] | undefined;
    let typeChange: BlockChange['typeChange'];
    let slugChange: BlockChange['slugChange'];
    let moved: MovedInfo | undefined;

    if (sourceAlive && !baseAlive) changeTypes.push('added');
    if (baseAlive && !sourceAlive) changeTypes.push('deleted');

    if (baseAlive && sourceAlive) {
      const isRoot = blockId === rootId;
      const baseProps = isRoot ? withoutSlug(base.properties) : base.properties;
      const sourceProps = isRoot
        ? withoutSlug(source.properties)
        : source.properties;

      const detail = diffProperties(baseProps, sourceProps, {
        isRichText: makeIsRichText(
          isRoot ? rootProperties : blockDefs[source.type]?.properties,
        ),
        diffText: diffRichText,
      });

      if (source.type !== base.type || detail.length > 0) {
        changeTypes.push('modified');
        propertyChanges = detail;
        if (source.type !== base.type) {
          typeChange = { from: base.type, to: source.type };
        }
      }

      if (isRoot) {
        const fromSlug = readRootSlug(base.properties);
        const toSlug = readRootSlug(source.properties);
        if (fromSlug !== toSlug) slugChange = { from: fromSlug, to: toSlug };
      }

      moved = movedByBlockId.get(blockId);
      // The root is never a child; guard against corrupted snapshots that
      // list it under some block, which would otherwise read as a reparent.
      if (!moved && !isRoot) {
        const baseParent = baseParentOf.get(blockId);
        const sourceParent = sourceParentOf.get(blockId);
        if ((baseParent?.parentId ?? null) !== (sourceParent?.parentId ?? null)) {
          moved = {
            kind: 'reparented',
            fromParentId: baseParent?.parentId ?? null,
            fromIndex: baseParent?.index ?? null,
            toParentId: sourceParent?.parentId ?? null,
            toIndex: sourceParent?.index ?? null,
          };
        }
      }
      if (moved) changeTypes.push('moved');

      if (reorderedParents.has(blockId)) changeTypes.push('childrenReordered');
    }

    if (changeTypes.length === 0 && !slugChange) continue;

    const change: BlockChange = {
      blockId,
      changeTypes,
      sourceVersion: source ?? null,
      targetVersion: targetBlocks.get(blockId) ?? null,
      baseVersion: base ?? null,
    };
    if (propertyChanges) change.propertyChanges = propertyChanges;
    if (typeChange) change.typeChange = typeChange;
    if (slugChange) change.slugChange = slugChange;
    if (moved) change.moved = moved;
    changes.push(change);

    for (const changeType of changeTypes) {
      if (changeType === 'added') summary.added++;
      else if (changeType === 'deleted') summary.deleted++;
      else if (changeType === 'modified') summary.modified++;
      else if (changeType === 'moved') summary.moved++;
      else summary.reordered++;
    }
  }

  return { changes, summary };
}
