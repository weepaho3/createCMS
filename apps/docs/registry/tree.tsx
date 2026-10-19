// @registry tree@0.3.2
'use client';

// Styled wrappers for the Tree.* parts. The class names are exported as
// well, so trees built on Tree.Item (a folder tree, an editor outline) look
// the same.

import type { TreeRootProps, TreeRow } from '@createcms/react/tree';

import { Tree as TreePrimitive } from '@createcms/react/tree';
import { ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** The tree container; the root level receiving a drag is tinted. */
const treeClassName =
  'flex flex-col text-sm outline-none data-drop-target:bg-primary/5 rounded-md';

/**
 * One row, indented by `--tree-level`. An unordered drop tints the
 * receiving row and its visible subtree as one block; a refused target is
 * tinted red; the row that received a drop flashes.
 */
const treeItemClassName = cn(
  'flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md py-1 pe-2 ps-[calc(var(--tree-indent)*var(--tree-level)+0.25rem)] outline-none select-none transition-colors',
  'hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-selected:bg-accent aria-selected:text-accent-foreground',
  'data-drop-target:bg-primary/10 data-drop-within:bg-primary/10 data-drop-within:rounded-none',
  '[&[data-drop-target]:has(+[data-drop-within])]:rounded-b-none [&[data-drop-within]:not(:has(+[data-drop-within]))]:rounded-b-md',
  'data-drop-blocked:bg-destructive/10 data-drop-flash:bg-primary/20 aria-busy:opacity-60',
);

/** The drop line of an ordered tree, with a ring marking where it starts. */
const treeDropIndicatorClassName = cn(
  'bg-primary z-10 h-0.5 -translate-y-1/2 rounded-full',
  'before:border-primary before:bg-background before:absolute before:-top-[3px] before:-left-1 before:size-2 before:rounded-full before:border-2',
  'data-blocked:bg-destructive data-blocked:before:border-destructive',
);

function Tree<TRow extends TreeRow>({
  className,
  indent = 16,
  indicator,
  ...props
}: TreeRootProps<TRow>) {
  return (
    <TreePrimitive.Root
      data-slot="tree"
      indent={indent}
      indicator={indicator ?? <TreeDropIndicator />}
      className={cn(treeClassName, className)}
      {...props}
    />
  );
}

function TreeItem({
  className,
  ...props
}: React.ComponentProps<typeof TreePrimitive.Item>) {
  return (
    <TreePrimitive.Item
      data-slot="tree-item"
      className={cn(treeItemClassName, className)}
      {...props}
    />
  );
}

/** The chevron of a row with children; a same-sized spacer otherwise. */
function TreeToggle({
  className,
  ...props
}: React.ComponentProps<typeof TreePrimitive.Toggle>) {
  return (
    <>
      <TreePrimitive.Toggle
        data-slot="tree-toggle"
        className={cn(
          'text-muted-foreground flex size-4 shrink-0 items-center justify-center transition-transform data-expanded:rotate-90 rtl:rotate-180 rtl:data-expanded:rotate-90',
          className,
        )}
        {...props}
      >
        <ChevronRightIcon className="size-3.5" />
      </TreePrimitive.Toggle>
      <TreeToggleSpacer />
    </>
  );
}

/** Keeps labels aligned on rows without children. */
function TreeToggleSpacer() {
  return (
    <span
      aria-hidden="true"
      className="hidden size-4 shrink-0 [[role=treeitem]:not([aria-expanded])>&]:block"
    />
  );
}

function TreeDropIndicator({
  className,
  ...props
}: React.ComponentProps<typeof TreePrimitive.DropIndicator>) {
  return (
    <TreePrimitive.DropIndicator
      data-slot="tree-drop-indicator"
      className={cn(treeDropIndicatorClassName, className)}
      {...props}
    />
  );
}

export {
  Tree,
  TreeDropIndicator,
  TreeItem,
  TreeToggle,
  treeClassName,
  treeDropIndicatorClassName,
  treeItemClassName,
};
