'use client';

// @createcms/react/tree: a headless tree over flat rows with keyboard
// navigation, type-ahead and drop instructions. Parts live on the `Tree`
// namespace; the framework-free kernel is `@createcms/react/tree/core`.
import { TreeDropIndicator, TreeItem, TreeRoot, TreeToggle } from './tree';

export const Tree = {
  Root: TreeRoot,
  Item: TreeItem,
  Toggle: TreeToggle,
  DropIndicator: TreeDropIndicator,
};

export {
  TREE_FLASH_MS,
  TREE_OPEN_DELAY_MS,
  TreeRowContext,
  useTreeDrop,
  useTreeItem,
} from './tree';
export type {
  TreeDndOptions,
  TreeDropIndicatorProps,
  TreeDropIndicatorState,
  TreeItemProps,
  TreeItemState,
  TreeRootProps,
  TreeRootState,
  TreeToggleProps,
} from './tree';
export type {
  TreeDropInstruction,
  TreeDropLine,
  TreeDropTarget,
  TreeRow,
} from './core';
