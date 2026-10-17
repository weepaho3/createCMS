import type { UseRenderComponentProps } from '../../use-render';

export type OutlineItemState = {
  selected: boolean;
  depth: number;
  hasChildren: boolean;
  blockId: string;
  blockType: string;
};

export type EditorOutlineItemProps = UseRenderComponentProps<
  'div',
  OutlineItemState
> & {
  /** The block this row represents (never the root). */
  blockId: string;
  /**
   * Runs before Delete/Backspace removes the block; return `false` to keep it
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

export type OutlineGroupState = { slot: string; blockId: string };

export type EditorOutlineGroupProps = UseRenderComponentProps<
  'div',
  OutlineGroupState
> & {
  /** The block whose slot this group holds. */
  blockId: string;
  /** The slot name. */
  slot: string;
};
