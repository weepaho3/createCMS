import type * as React from 'react';

import type { TreeItemState } from '../../tree';
import type { UseRenderComponentProps } from '../../use-render';
import type { OutlineRow, OutlineRowsOptions } from './outline-rows';

export type OutlineItemState = TreeItemState & {
  /** `node` for a block row, `slot` for a slot label row. */
  kind: 'node' | 'slot';
  /** The block is in the selection (never for slot rows). */
  selected: boolean;
  /** The pointer is over this block (here, in the canvas or a preview). */
  hovered: boolean;
  /** The block of the row; for a slot row the block that holds the slot. */
  blockId: string;
  /** The block type; `slot` rows carry their block's type. */
  blockType: string;
  /** The slot of a slot row; for a block row the slot it sits in (`data-slot-name`). */
  slotName: string;
};

export type EditorOutlineItemProps = UseRenderComponentProps<
  'div',
  OutlineItemState
> & {
  /** The row (from `Editor.Outline`'s `children` callback). */
  row: OutlineRow;
};

/** Props of `Editor.Outline`, the `role="tree"` container. */
export type EditorOutlineProps = Omit<
  UseRenderComponentProps<'div'>,
  'children'
> & {
  /** Renders one row; default `<Editor.OutlineItem row={row} />`. */
  children?: (row: OutlineRow) => React.ReactNode;
  /** Rendered after the rows, usually `Editor.OutlineDropIndicator`. */
  indicator?: React.ReactNode;
  /** Pixels per nesting level (`--tree-indent`); dragging left by this much moves a block out one level. Default 16. */
  indent?: number;
  /** The rows to show (`useOutlineRows`); default: computed by the outline. Pass them when a virtualizer needs the same list. */
  rows?: readonly OutlineRow[];
  /** Virtualized outlines: render only the rows from `start` to `end`. Keys still reach every row. */
  range?: { start: number; end: number };
  /** Brings a row that is not rendered into view before it takes focus. */
  reveal?: (id: string) => void;
  /** `labelled` (default) or `none`, as in `useOutlineRows`; ignored with `rows`. */
  slotRows?: OutlineRowsOptions['slotRows'];
  /**
   * Runs before Delete/Backspace removes a block; return `false` to keep it
   * (for example to open a confirmation and remove later through
   * `useBlockActions`).
   */
  onDelete?: (blockId: string) => boolean | void;
};

export type AddBlockState = { blockType: string };

/**
 * `type` is the block type; the DOM `type="button"` is set by the part, so
 * the button's own `type` prop is omitted.
 */
export type EditorAddBlockProps = Omit<
  UseRenderComponentProps<'button', AddBlockState>,
  'type'
> & {
  /** The block type to insert (a `usePalette()` entry's `type`). */
  type: string;
  /**
   * Target parent; default: derived from the selection (see the part's
   * docs).
   */
  parentId?: string;
  /** Target slot of `parentId`; default `children`. */
  slot?: string;
  /**
   * Position in the target slot; default: append (or right after the
   * selected sibling).
   */
  index?: number;
};
