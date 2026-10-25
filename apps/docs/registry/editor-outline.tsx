// @registry editor-outline@0.3.2
'use client';

// The block tree as a virtualized APG tree (`@createcms/react/tree` under
// `Editor.Outline`, windowed with `@tanstack/react-virtual`). Plugins add
// row buttons through the `outline-row-actions` outlet.

import type { OutlineRow } from '@createcms/react/editor';

import {
  Editor,
  useBlockActions,
  useOutlineRows,
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

import { blockTypeIcon, useEditorChrome, useMediaQuery } from './editor-chrome';

const OUTLINE_ROW_PX = 32;
/** 44px rows under a coarse pointer (WCAG 2.5.5 touch targets). */
const OUTLINE_ROW_COARSE_PX = 44;
const OUTLINE_INDENT_PX = 12;

const rowClassName = cn(
  'absolute left-0 flex w-full items-center gap-2 rounded-md pr-2 text-sm outline-none',
  'ps-[calc(8px+var(--tree-indent)*var(--tree-level))]',
  'focus-visible:ring-sidebar-ring focus-visible:ring-2 focus-visible:ring-inset',
  'data-[drop-target]:bg-editor-drop/10 data-[drop-target]:ring-editor-drop data-[drop-target]:ring-2 data-[drop-target]:ring-inset',
  'data-[drop-blocked]:cursor-not-allowed data-[drop-blocked]:bg-destructive/10',
  'data-[dragging]:opacity-50',
);

/** Move buttons for the selected row under touch: the path without dragging. */
function TouchMoveButtons({ blockId }: { blockId: string }) {
  const actions = useBlockActions(blockId);
  // Keyboard users move with Alt+Arrow; these buttons are the touch path,
  // so they stay out of the tab order.
  return (
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
  );
}

/** One row: a block (toggle, icon, label) or a slot label. */
function OutlineRowView({
  row,
  start,
  height,
  compact,
}: {
  row: OutlineRow;
  start: number;
  height: number;
  /** Touch layout: the selected row shows move up and down buttons. */
  compact: boolean;
}) {
  const selected = useSelection().selected === row.id;
  const palette = usePalette();
  const style = { top: 0, height, transform: `translateY(${start}px)` };

  if (row.kind === 'slot') {
    return (
      <Editor.OutlineItem
        row={row}
        className={cn(
          rowClassName,
          'text-muted-foreground items-end pb-1 text-xs font-medium',
        )}
        style={style}
      />
    );
  }
  const label =
    palette.find((item) => item.type === row.type)?.label ?? row.type;
  const Icon = blockTypeIcon(row.type);
  return (
    <Editor.OutlineItem
      row={row}
      className={cn(
        rowClassName,
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[selected]:bg-sidebar-accent data-[selected]:font-medium',
      )}
      style={style}
    >
      <span className="flex size-4 shrink-0 items-center justify-center pointer-coarse:size-11">
        <Editor.OutlineToggle className="flex size-4 items-center justify-center">
          <ChevronRightIcon
            className={cn(
              'size-3.5 transition-transform motion-reduce:transition-none',
              row.expanded && 'rotate-90',
            )}
          />
        </Editor.OutlineToggle>
      </span>
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      {compact && selected ? <TouchMoveButtons blockId={row.id} /> : null}
      <Editor.Slot name="outline-row-actions" props={{ blockId: row.id }} />
    </Editor.OutlineItem>
  );
}

/**
 * The block tree as a virtualized APG tree: only the rows in view mount,
 * keyboard navigation reaches every row, rows drag to reorder and nest.
 */
function EditorOutline({
  className,
  scrollClassName,
  ...props
}: React.ComponentProps<'div'> & { scrollClassName?: string }) {
  const rows = useOutlineRows();
  const coarse = useMediaQuery('(pointer: coarse)');
  const { layout } = useEditorChrome();
  const rowHeight = coarse ? OUTLINE_ROW_COARSE_PX : OUTLINE_ROW_PX;
  const indexById = React.useMemo(
    () => new Map(rows.map((row, index) => [row.id, index])),
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
  const items = virtualizer.getVirtualItems();
  const range =
    items.length > 0
      ? { start: items[0]!.index, end: items[items.length - 1]!.index }
      : { start: 0, end: -1 };
  const reveal = React.useCallback(
    (id: string) => {
      const index = indexById.get(id);
      if (index !== undefined) {
        virtualizer.scrollToIndex(index, { align: 'auto' });
      }
    },
    [indexById, virtualizer],
  );

  return (
    <SidebarGroup data-slot="editor-outline" className={className} {...props}>
      <SidebarGroupLabel>Outline</SidebarGroupLabel>
      {/* The padding keeps the drop line above the first row and the
          rings of the rows inside the scroll area, which clips. */}
      <SidebarGroupContent
        ref={scrollRef}
        className={cn('max-h-[50vh] overflow-y-auto p-1', scrollClassName)}
      >
        <Editor.Outline
          rows={rows}
          range={range}
          reveal={reveal}
          indent={OUTLINE_INDENT_PX}
          style={{ height: virtualizer.getTotalSize() }}
          className="data-[dragging]:cursor-grabbing"
          indicator={
            <Editor.OutlineDropIndicator className="bg-editor-drop data-[blocked]:bg-destructive z-10 h-0.5 -translate-y-px rounded-full" />
          }
        >
          {(row) => (
            <OutlineRowView
              key={row.id}
              row={row}
              start={(indexById.get(row.id) ?? 0) * rowHeight}
              height={rowHeight}
              compact={coarse || layout === 'phone'}
            />
          )}
        </Editor.Outline>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export { EditorOutline };
