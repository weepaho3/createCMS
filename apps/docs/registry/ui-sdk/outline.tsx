// @registry ui-sdk-editor@0.3.2
'use client';

// The document as a UI SDK Tree: keyboard per the APG tree pattern,
// virtualized rows, selection and hover in sync with the canvas, branches
// collapsed through the store. Rows drag to reorder and to nest, checked
// against the schema's placement rules. Plugins add row buttons through
// the `outline-row-actions` outlet.

import type { OutlineRow } from '@createcms/react/editor';
import type { SlotRef } from '@createcms/react/editor/core';
import type { TreeItemData } from '@ui-sdk/react/tree';

import {
  Editor,
  outlineRows,
  useBlockActions,
  useDocSelector,
  useEditorContext,
  useEditorStore,
  useHovered,
  usePalette,
  useSelection,
  useSessionSelector,
} from '@createcms/react/editor';
import {
  canPlaceIn,
  isSelfOrDescendant,
  slotsOf,
} from '@createcms/react/editor/core';
import { Button } from '@ui-sdk/react/button';
import {
  Tree,
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  visibleTreeRows,
} from '@ui-sdk/react/tree';
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

import { blockIcon, useChrome, useMediaQuery } from './chrome';

const ROW = 32;
const ROW_COARSE = 44;
const OVERSCAN = 6;
/** The share of a row's height at its top and bottom that drops before or after it. */
const EDGE = 0.3;

type Drop = {
  /** The row the line or box is drawn at, by visible index. */
  index: number;
  place: 'before' | 'after' | 'inside';
  target: { parent: SlotRef; index: number } | null;
};

function useRows() {
  const { schema } = useEditorContext('BlockOutline');
  return useDocSelector(
    (doc) => outlineRows(schema, doc.nodes, doc.rootId, []),
    (a, b) =>
      a.length === b.length &&
      a.every((row, i) => {
        const other = b[i]!;
        return (
          row.id === other.id &&
          row.parentId === other.parentId &&
          row.posinset === other.posinset &&
          row.kind === other.kind &&
          (row.kind !== 'node' ||
            (other.kind === 'node' && row.type === other.type))
        );
      }),
  );
}

/** The rows as the nested data the tree takes. */
function toItems(
  rows: readonly OutlineRow[],
  labelOf: (row: OutlineRow) => string,
): TreeItemData[] {
  const roots: TreeItemData[] = [];
  const byId = new Map<string, TreeItemData>();
  for (const row of rows) {
    const item: TreeItemData = { value: row.id, label: labelOf(row) };
    if (row.kind === 'slot' || row.hasChildren) item.children = [];
    byId.set(row.id, item);
    const parent = row.parentId === null ? null : byId.get(row.parentId);
    (parent?.children ?? roots).push(item);
  }
  return roots;
}

function TouchMove({ blockId }: { blockId: string }) {
  const actions = useBlockActions(blockId);
  // Alt+Arrow moves by keyboard; these are the touch path, out of the tab order.
  return (
    <span aria-hidden className="ed-row">
      {(
        [
          ['up', actions.canMoveUp, () => actions.moveUp(), ArrowUpIcon],
          [
            'down',
            actions.canMoveDown,
            () => actions.moveDown(),
            ArrowDownIcon,
          ],
        ] as const
      ).map(([key, can, move, Icon]) => (
        <Button
          key={key}
          tabIndex={-1}
          disabled={!can}
          className="ed-button"
          data-variant="ghost"
          data-size="icon-touch"
          onClick={(event) => {
            event.stopPropagation();
            move();
          }}
        >
          <Icon />
        </Button>
      ))}
    </span>
  );
}

export function BlockOutline({ fill = false }: { fill?: boolean }) {
  const { schema } = useEditorContext('BlockOutline');
  const store = useEditorStore();
  const palette = usePalette();
  const { selection } = useSelection();
  const hovered = useHovered();
  const sessionCollapsed = useSessionSelector((s) => s.collapsed);
  const { layout } = useChrome();
  const coarse = useMediaQuery('(pointer: coarse)');
  const rowHeight = coarse ? ROW_COARSE : ROW;
  const rows = useRows();
  const byId = React.useMemo(
    () => new Map(rows.map((row) => [row.id, row])),
    [rows],
  );

  const labelOf = React.useCallback(
    (row: OutlineRow) => {
      if (row.kind === 'slot') {
        const type = store.getDoc().nodes[row.blockId]?.type;
        const spec = type ? slotsOf(schema, type)[row.slot] : undefined;
        return spec?.label ?? row.slot;
      }
      return palette.find((item) => item.type === row.type)?.label ?? row.type;
    },
    [palette, schema, store],
  );
  const items = React.useMemo(() => toItems(rows, labelOf), [rows, labelOf]);
  const expanded = React.useMemo(
    () =>
      rows
        .filter(
          (row) =>
            row.kind === 'slot' ||
            (row.hasChildren && !sessionCollapsed.includes(row.id)),
        )
        .map((row) => row.id),
    [rows, sessionCollapsed],
  );
  const visible = React.useMemo(
    () => visibleTreeRows(items, expanded),
    [items, expanded],
  );
  const indexOf = React.useMemo(
    () => new Map(visible.map((row) => [row.item.value, row.index])),
    [visible],
  );

  const scroller = React.useRef<HTMLDivElement | null>(null);
  const [view, setView] = React.useState({ top: 0, height: 400 });
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () =>
      setView({ top: el.scrollTop, height: el.clientHeight || 400 });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const scrollTo = React.useCallback(
    (index: number) => {
      const el = scroller.current;
      if (!el) return;
      const top = index * rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + rowHeight > el.scrollTop + el.clientHeight) {
        el.scrollTop = top + rowHeight - el.clientHeight;
      }
      setView({ top: el.scrollTop, height: el.clientHeight || 400 });
    },
    [rowHeight],
  );

  // The selection, picked anywhere, scrolls into view here.
  const primary = selection[0] ?? null;
  React.useEffect(() => {
    if (primary === null) return;
    const index = indexOf.get(primary);
    if (index !== undefined) scrollTo(index);
  }, [primary, indexOf, scrollTo]);

  const [drop, setDrop] = React.useState<Drop | null>(null);
  const drag = React.useRef<{
    id: string;
    x: number;
    y: number;
    on: boolean;
  } | null>(null);

  const dropAt = (clientY: number, draggedId: string): Drop | null => {
    const tree = scroller.current?.querySelector('[role="tree"]');
    if (!tree) return null;
    const y = clientY - tree.getBoundingClientRect().top;
    const index = Math.max(
      0,
      Math.min(visible.length - 1, Math.floor(y / rowHeight)),
    );
    const entry = visible[index];
    const row = entry ? byId.get(entry.item.value) : undefined;
    if (!row) return null;
    const within = (y - index * rowHeight) / rowHeight;
    const nodes = store.getDoc().nodes;
    const dragged = nodes[draggedId];
    if (!dragged) return null;
    let place: Drop['place'] =
      within < EDGE ? 'before' : within > 1 - EDGE ? 'after' : 'inside';
    if (row.kind === 'slot') place = 'inside';
    let parent: SlotRef | null = null;
    let at = 0;
    if (place === 'inside') {
      if (row.kind === 'slot') {
        parent = { id: row.blockId, slot: row.slot };
      } else {
        const slots = Object.keys(slotsOf(schema, row.type));
        const own =
          row.hasChildren &&
          rows.some((r) => r.kind === 'slot' && r.blockId === row.id);
        if (slots[0] && !own) parent = { id: row.id, slot: slots[0] };
        else place = within < 0.5 ? 'before' : 'after';
      }
      if (parent) at = nodes[parent.id]?.slots[parent.slot]?.length ?? 0;
    }
    if (place !== 'inside' && row.kind === 'node') {
      parent = row.parent;
      at = row.posinset - 1 + (place === 'after' ? 1 : 0);
    }
    if (!parent) return { index, place, target: null };
    const from = dragged.parent;
    // The store counts the index with the dragged block already gone.
    if (from && from.id === parent.id && from.slot === parent.slot) {
      const old = nodes[from.id]?.slots[from.slot]?.indexOf(draggedId) ?? -1;
      if (old !== -1 && old < at) at -= 1;
    }
    const ok =
      !isSelfOrDescendant(nodes, draggedId, parent.id) &&
      canPlaceIn(schema, nodes, dragged.type, parent, { movingId: draggedId })
        .ok;
    return { index, place, target: ok ? { parent, index: at } : null };
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const row = (event.target as Element).closest<HTMLElement>(
      '[role="treeitem"]',
    );
    const id = row?.dataset.value;
    if (!id || byId.get(id)?.kind !== 'node') return;
    if (
      (event.target as Element).closest(
        '[data-slot="tree-item-indicator"], button',
      )
    )
      return;
    drag.current = { id, x: event.clientX, y: event.clientY, on: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    if (!current.on) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4)
        return;
      current.on = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    setDrop(dropAt(event.clientY, current.id));
  };
  const endDrag = (commit: boolean) => {
    const current = drag.current;
    drag.current = null;
    const target = drop?.target;
    setDrop(null);
    if (commit && current?.on && target) store.move(current.id, target);
  };

  const start = Math.max(0, Math.floor(view.top / rowHeight) - OVERSCAN);
  const end = Math.min(
    visible.length,
    Math.ceil((view.top + view.height) / rowHeight) + OVERSCAN,
  );
  const touch = coarse || layout === 'phone';

  return (
    <section
      data-slot="editor-outline"
      aria-labelledby="ed-outline-title"
      className="ed-panel-section"
      data-fill={fill || undefined}
    >
      <header className="ed-panel-heading">
        <h2 id="ed-outline-title">Outline</h2>
      </header>
      <div
        ref={scroller}
        className="ed-outline-scroll"
        onScroll={(event) =>
          setView({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight || 400,
          })
        }
      >
        <Tree
          aria-labelledby="ed-outline-title"
          items={items}
          mode="multiple"
          activation="manual"
          value={selection.filter((id) => byId.get(id)?.kind === 'node')}
          onValueChange={(value) => {
            const ids = (Array.isArray(value) ? value : value ? [value] : [])
              .map((id) => {
                const row = byId.get(id);
                return row?.kind === 'slot' ? row.blockId : id;
              })
              .filter((id, i, all) => all.indexOf(id) === i);
            store.setSelection(ids);
          }}
          expanded={expanded}
          onExpandedChange={(next) => {
            for (const row of rows) {
              if (row.kind !== 'node' || !row.hasChildren) continue;
              const open = next.includes(row.id);
              if (open === sessionCollapsed.includes(row.id)) {
                store.setCollapsed(row.id, !open);
              }
            }
          }}
          onHighlight={(_value, details) => scrollTo(details.index)}
          className="ed-tree"
          data-dragging={drop ? '' : undefined}
          style={
            {
              height: visible.length * rowHeight,
              '--row': `${rowHeight}px`,
            } as React.CSSProperties
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          onPointerCancel={() => endDrag(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && drag.current) endDrag(false);
          }}
          onPointerLeave={() => store.hover(null)}
        >
          {visible.slice(start, end).map(({ item, index }) => {
            const row = byId.get(item.value);
            if (!row) return null;
            const Icon = row.kind === 'node' ? blockIcon(row.type) : null;
            const id = row.kind === 'node' ? row.id : row.blockId;
            return (
              <TreeItem
                key={item.value}
                value={item.value}
                data-value={item.value}
                data-kind={row.kind}
                data-hovered={
                  hovered === id && row.kind === 'node' ? '' : undefined
                }
                className="ed-tree-item"
                style={{ top: index * rowHeight, height: rowHeight }}
                onPointerEnter={() => {
                  if (row.kind === 'node') store.hover(row.id);
                }}
              >
                <TreeItemLabel className="ed-tree-label">
                  {item.children && row.kind === 'node' ? (
                    <TreeItemIndicator className="ed-tree-toggle">
                      <ChevronRightIcon aria-hidden />
                    </TreeItemIndicator>
                  ) : (
                    <span className="ed-tree-toggle" />
                  )}
                  {Icon ? <Icon aria-hidden /> : null}
                  <span className="ed-tree-text">{item.label}</span>
                  {row.kind === 'node' && touch && primary === row.id ? (
                    <TouchMove blockId={row.id} />
                  ) : null}
                  {row.kind === 'node' ? (
                    <Editor.Slot
                      name="outline-row-actions"
                      props={{ blockId: row.id }}
                    />
                  ) : null}
                </TreeItemLabel>
              </TreeItem>
            );
          })}
          {drop ? (
            <span
              aria-hidden
              className="ed-drop"
              data-place={drop.place}
              data-blocked={drop.target ? undefined : ''}
              style={
                {
                  top:
                    (drop.index + (drop.place === 'after' ? 1 : 0)) * rowHeight,
                  height: drop.place === 'inside' ? rowHeight : undefined,
                  '--level': visible[drop.index]?.level ?? 1,
                } as React.CSSProperties
              }
            />
          ) : null}
        </Tree>
      </div>
    </section>
  );
}
