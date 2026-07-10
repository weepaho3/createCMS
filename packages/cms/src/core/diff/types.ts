import type { ReconstructedBlock } from '../blocks/reconstruct-snapshot';

// ============================================================================
// Visual diff contract
//
// Shared shapes for the branch diff (`getDiff`): the flat change list, the
// per-property detail, and the annotated render tree. Pure types — the
// algorithms live in sibling modules (classify.ts, property-diff.ts,
// text-diff.ts, annotated-tree.ts).
// ============================================================================

/**
 * Classification labels attached to a block in a diff.
 *
 * - `moved` is only assigned to blocks that actually moved: reparented, or a
 *   true reorder outlier among surviving siblings (LIS-based). Siblings whose
 *   index merely shifted because another block was inserted/removed/moved
 *   around them are NOT marked.
 * - `childrenReordered` is only assigned to a parent when the RELATIVE order
 *   of its surviving common children changed — never for pure child
 *   additions/removals.
 */
export type ChangeType =
  | 'added'
  | 'deleted'
  | 'modified'
  | 'moved'
  | 'childrenReordered';

/** One run of a word-level rich-text diff. `html` is a raw HTML fragment. */
export type TextDiffSegment = {
  type: 'same' | 'ins' | 'del';
  html: string;
};

export type PropertyChangeKind = 'added' | 'removed' | 'changed';

/**
 * One granular property difference inside a modified block.
 *
 * `path` addresses the value from the properties root: string segments for
 * object keys, number segments for array indices (index into the NEW array for
 * `added`, into the OLD array for `removed`; `changed` entries produced by
 * array pairing address the NEW array).
 */
export type PropertyChange = {
  path: (string | number)[];
  kind: PropertyChangeKind;
  /** Old value. Absent for `added`. */
  from?: unknown;
  /** New value. Absent for `removed`. */
  to?: unknown;
  /**
   * Word-level segments for `richText` properties (per the collection schema).
   * Only present when kind is `changed` and both sides are strings.
   */
  textDiff?: TextDiffSegment[];
};

/**
 * Commit attribution for one diff entry. Only present when `getDiff` is called
 * with `withAttribution: true` (and only for entries whose authoring commit is
 * derivable):
 *
 * - An entry whose own version changed (added / deleted / modified /
 *   childrenReordered / slug change) carries the commit that created its
 *   `sourceVersion`.
 * - A pure position move (`moved` with an unchanged own version) carries the
 *   commit that actually repositioned the block under its new parent — the
 *   last commit on the source side's first-parent chain whose version of the
 *   new parent changed the block's presence/index in `children` (multiple
 *   moves → the latest one). Attribution is OMITTED — never guessed — when
 *   that commit is not derivable, e.g. the move landed via a merge's source
 *   side.
 *
 * Each entry carries its own attribution object (entries authored by the same
 * commit do not share one).
 */
export type ChangeAttribution = {
  commitId: string;
  changedAt: Date;
  changedBy: string | null;
  /** Present only when called with `query.withUser`. Shape depends on the
   *  configured user table; left as `unknown` until cross-table inference. */
  changedByUser?: unknown;
};

/** Where a `moved` block came from and where it went. */
export type MovedInfo = {
  /** `reparented` = parent changed; `reordered` = same parent, new position. */
  kind: 'reparented' | 'reordered';
  fromParentId: string | null;
  /** Index among the OLD parent's alive children. */
  fromIndex: number | null;
  toParentId: string | null;
  /** Index among the NEW parent's alive children. */
  toIndex: number | null;
};

/** One entry of the flat diff list returned by `getDiff`. */
export type BlockChange = {
  blockId: string;
  changeTypes: ChangeType[];
  /** Granular property detail. Present when `modified`. */
  propertyChanges?: PropertyChange[];
  /** Present when the block type changed (also implies `modified`). */
  typeChange?: { from: string; to: string };
  /** Root entry only: the versioned draft slug changed. */
  slugChange?: { from: string | null; to: string | null };
  /** Present when `moved`. */
  moved?: MovedInfo;
  /**
   * Only present with `withAttribution`, and only when the authoring commit
   * is derivable (pure moves: the commit that repositioned the block under
   * its new parent; omitted when not derivable). See {@link ChangeAttribution}.
   */
  attribution?: ChangeAttribution;
  sourceVersion: ReconstructedBlock | null;
  targetVersion: ReconstructedBlock | null;
  baseVersion: ReconstructedBlock | null;
};

/** Per-changeType entry counts (an entry with several types counts in each). */
export type DiffSummary = {
  added: number;
  deleted: number;
  modified: number;
  moved: number;
  /** Parents whose surviving children were truly reordered. */
  reordered: number;
};

/** The render-facing annotation carried by changed nodes of the diff tree. */
export type BlockDiffAnnotation = {
  changeTypes: ChangeType[];
  propertyChanges?: PropertyChange[];
  typeChange?: { from: string; to: string };
  slugChange?: { from: string | null; to: string | null };
  moved?: MovedInfo;
  /** Only present with `withAttribution`. See {@link ChangeAttribution}. */
  attribution?: ChangeAttribution;
};

/**
 * A `BlockTreeNode` superset: the source (draft) tree annotated per node, with
 * deleted blocks re-inserted as ghost nodes at their old position (carrying
 * the content they had at the common ancestor — their `baseVersion`).
 * Unchanged nodes omit `diff`.
 *
 * Structurally assignable to `BlockTreeNode`, so it renders through the same
 * component maps and `BlocksRenderer` as a regular page tree.
 */
export type AnnotatedBlockTreeNode = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  diff?: BlockDiffAnnotation;
  children: AnnotatedBlockTreeNode[];
};

/** Which representations `getDiff` should return. */
export type DiffView = 'list' | 'tree' | 'both';
