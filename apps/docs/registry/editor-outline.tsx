// @registry editor-outline@0.3.2
'use client';

// The block tree as a virtualized APG tree (`@tanstack/react-virtual`).
// Plugins add row buttons through the `outline-row-actions` outlet.

import type { FlatOutlineNodeRow } from '@createcms/react/editor';

import {
  Editor,
  useBlockActions,
  useEditorStore,
  useFlatOutline,
  usePalette,
  useSelection,
} from '@createcms/react/editor';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

import { useMediaQuery, useEditorChrome, blockTypeIcon } from './editor-chrome';

const OUTLINE_ROW_PX = 32;
/** 44px rows under a coarse pointer (WCAG 2.5.5 touch targets). */
const OUTLINE_ROW_COARSE_PX = 44;

/** One block row: the APG tree item, a collapse toggle, icon and label. */
function OutlineRow({
  row,
  start,
  height,
  compact,
}: {
  row: FlatOutlineNodeRow;
  start: number;
  height: number;
  /** Touch layout: the selected row shows move up and down buttons. */
  compact: boolean;
}) {
  const store = useEditorStore();
  const selected = useSelection().selected === row.id;
  const actions = useBlockActions(row.id);
  const palette = usePalette();
  const label =
    palette.find((item) => item.type === row.type)?.label ?? row.type;
  const Icon = blockTypeIcon(row.type);
  return (
    <Editor.OutlineItem
      blockId={row.id}
      data-active={selected || undefined}
      className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[active]:bg-sidebar-accent focus-visible:ring-sidebar-ring absolute left-0 flex w-full items-center gap-2 rounded-md pr-2 text-sm outline-none focus-visible:ring-2 data-[active]:font-medium"
      style={{
        top: 0,
        height,
        transform: `translateY(${start}px)`,
        paddingLeft: 8 + (row.level - 1) * 12,
      }}
    >
      {row.hasChildren ? (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center pointer-coarse:size-11"
          onClick={(event) => {
            event.stopPropagation();
            store.setCollapsed(row.id, row.expanded);
          }}
        >
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-transform',
              row.expanded && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span className="size-4 shrink-0 pointer-coarse:w-11" />
      )}
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {compact && selected ? (
        // Keyboard users move with the tree's own shortcuts; these buttons
        // are the touch path, so they stay out of the tab order.
        <span className="flex items-center" aria-hidden>
          <button
            type="button"
            tabIndex={-1}
            disabled={!actions.canMoveUp}
            className="flex size-11 items-center justify-center disabled:opacity-40"
            onClick={(event) => {
              event.stopPropagation();
              actions.moveUp();
            }}
          >
            <ArrowUpIcon className="size-4" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={!actions.canMoveDown}
            className="flex size-11 items-center justify-center disabled:opacity-40"
            onClick={(event) => {
              event.stopPropagation();
              actions.moveDown();
            }}
          >
            <ArrowDownIcon className="size-4" />
          </button>
        </span>
      ) : null}
      <Editor.Slot name="outline-row-actions" props={{ blockId: row.id }} />
    </Editor.OutlineItem>
  );
}

/**
 * The block tree as a virtualized APG tree: only the rows in view mount,
 * keyboard navigation reaches every row (`Editor.Outline rows`), rows drag
 * to reorder and nest.
 */
function EditorOutline({
  className,
  scrollClassName,
  ...props
}: React.ComponentProps<'div'> & { scrollClassName?: string }) {
  const rows = useFlatOutline();
  const coarse = useMediaQuery('(pointer: coarse)');
  const { layout } = useEditorChrome();
  const rowHeight = coarse ? OUTLINE_ROW_COARSE_PX : OUTLINE_ROW_PX;
  const ids = React.useMemo(
    () => rows.flatMap((row) => (row.kind === 'node' ? [row.id] : [])),
    [rows],
  );
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  // on purpose: the virtualizer's functions change every render; this
  // component re-renders with it, nothing below memoizes them.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });
  React.useEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);
  const reveal = React.useCallback(
    (id: string) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) virtualizer.scrollToIndex(index, { align: 'auto' });
    },
    [rows, virtualizer],
  );

  return (
    <SidebarGroup data-slot="editor-outline" className={className} {...props}>
      <SidebarGroupLabel>Outline</SidebarGroupLabel>
      <SidebarGroupContent
        ref={scrollRef}
        className={cn('max-h-[50vh] overflow-y-auto', scrollClassName)}
      >
        <Editor.Outline
          rows={ids}
          reveal={reveal}
          style={{ height: virtualizer.getTotalSize() }}
          className={cn(
            'data-[dragging]:cursor-grabbing [&_[data-dragging]]:opacity-50',
            '[&_[data-editor-outline-drop-indicator]]:z-10',
            '[&_[data-editor-outline-drop-indicator][data-variant=line]]:bg-editor-drop [&_[data-editor-outline-drop-indicator][data-variant=line]]:-translate-y-px [&_[data-editor-outline-drop-indicator][data-variant=line]]:rounded-full',
            '[&_[data-editor-outline-drop-indicator][data-variant=box]]:border-editor-drop [&_[data-editor-outline-drop-indicator][data-variant=box]]:bg-editor-drop/10 [&_[data-editor-outline-drop-indicator][data-variant=box]]:rounded-md [&_[data-editor-outline-drop-indicator][data-variant=box]]:border-2',
          )}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            return row.kind === 'node' ? (
              <OutlineRow
                key={row.id}
                row={row}
                start={item.start}
                height={rowHeight}
                compact={coarse || layout === 'phone'}
              />
            ) : (
              <span
                key={row.id}
                aria-hidden
                className="text-muted-foreground absolute left-0 flex w-full items-end pb-1 text-xs"
                style={{
                  top: 0,
                  height: rowHeight,
                  transform: `translateY(${item.start}px)`,
                  paddingLeft: 8 + (row.level - 1) * 12,
                }}
              >
                {row.slot}
              </span>
            );
          })}
        </Editor.Outline>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export { EditorOutline };
