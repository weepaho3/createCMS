// @registry ui-sdk-editor@0.3.2
'use client';

import type { OutlineRow } from '@createcms/react/editor';
import type { SlotRef } from '@createcms/react/editor/core';

import {
  Editor,
  outlineRows,
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
import { createParts } from '@ui-sdk/react/primitive';
import { ChevronRightIcon, GripVerticalIcon } from 'lucide-react';
import * as React from 'react';

import { blockOutline } from './block-outline';
import { Chrome, blockIcon } from './chrome';

const Tree = createParts(blockOutline, {
  root: 'div',
  row: 'div',
  toggle: 'span',
  handle: 'span',
  instructions: 'p',
});

const sameRows = (a: readonly OutlineRow[], b: readonly OutlineRow[]) =>
  a.length === b.length &&
  a.every((row, i) => {
    const other = b[i]!;
    return (
      row.id === other.id &&
      row.parentId === other.parentId &&
      row.level === other.level &&
      row.posinset === other.posinset &&
      row.hasChildren === other.hasChildren &&
      row.kind === other.kind &&
      (row.kind !== 'node' ||
        (other.kind === 'node' && row.type === other.type))
    );
  });

function useOutline() {
  const { schema } = useEditorContext('BlockOutline');
  const store = useEditorStore();
  const palette = usePalette();
  const outline = useDocSelector(
    (doc) => outlineRows(schema, doc.nodes, doc.rootId, []),
    sameRows,
  );
  const byId = React.useMemo(
    () => new Map(outline.map((row) => [row.id, row])),
    [outline],
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

  const slotFor = React.useCallback(
    (parent: string | null): SlotRef | null => {
      if (parent === null) {
        const top = outline.filter((row) => row.parentId === null);
        if (top.some((row) => row.kind === 'slot')) return null;
        const first = top.find((row) => row.kind === 'node');
        if (first?.kind === 'node') return first.parent;
        return { id: store.getDoc().rootId, slot: 'children' };
      }
      const row = byId.get(parent);
      if (!row) return null;
      if (row.kind === 'slot') return { id: row.blockId, slot: row.slot };
      const children = outline.filter((child) => child.parentId === row.id);
      if (children.some((child) => child.kind === 'slot')) return null;
      const child = children.find((c) => c.kind === 'node');
      if (child?.kind === 'node') return child.parent;
      const slot = Object.keys(slotsOf(schema, row.type))[0];
      return slot ? { id: row.id, slot } : null;
    },
    [byId, outline, schema, store],
  );

  const canPlace = React.useCallback(
    (key: string, parent: string | null) => {
      const target = slotFor(parent);
      if (!target) return false;
      const nodes = store.getDoc().nodes;
      const dragged = nodes[key];
      if (!dragged || isSelfOrDescendant(nodes, key, target.id)) return false;
      return canPlaceIn(schema, nodes, dragged.type, target, { movingId: key })
        .ok;
    },
    [schema, slotFor, store],
  );

  return { outline, byId, labelOf, slotFor, canPlace };
}

export function BlockOutline({ fill = false }: { fill?: boolean }) {
  const store = useEditorStore();
  const { selection } = useSelection();
  const hovered = useHovered();
  const collapsed = useSessionSelector((s) => s.collapsed);
  const { outline, byId, labelOf, slotFor, canPlace } = useOutline();

  const rows = React.useMemo(
    () => outline.map((row) => ({ key: row.id, depth: row.level - 1 })),
    [outline],
  );
  const fixed = React.useMemo(
    () => outline.filter((row) => row.kind === 'slot').map((row) => row.id),
    [outline],
  );
  const expanded = React.useMemo(
    () =>
      outline
        .filter(
          (row) =>
            row.kind === 'node' &&
            row.hasChildren &&
            !collapsed.includes(row.id),
        )
        .map((row) => row.id),
    [outline, collapsed],
  );
  const selected = React.useMemo(
    () => selection.filter((id) => byId.get(id)?.kind === 'node'),
    [selection, byId],
  );

  return (
    <Chrome.Outline className="ed-panel-section" data-fill={fill || undefined}>
      <header className={fill ? 'ed-sr' : 'ed-panel-heading'}>
        <Chrome.OutlineTitle>Outline</Chrome.OutlineTitle>
      </header>
      <div className="ed-outline-scroll">
        <Tree.Root
          aria-label="Outline"
          className="ed-tree"
          rows={rows}
          onRowsChange={(_next, details) => {
            const parent = slotFor(details.parent);
            if (parent)
              store.move(details.key, { parent, index: details.index });
          }}
          expanded={expanded}
          onExpandedChange={(next) => {
            for (const row of outline) {
              if (row.kind !== 'node' || !row.hasChildren) continue;
              const open = next.includes(row.id);
              if (open === collapsed.includes(row.id)) {
                store.setCollapsed(row.id, !open);
              }
            }
          }}
          selected={selected}
          onSelectedChange={(next) => {
            const ids = next
              .map((id) => {
                const row = byId.get(id);
                return row?.kind === 'slot' ? row.blockId : id;
              })
              .filter((id, i, all) => all.indexOf(id) === i);
            store.setSelection(ids);
          }}
          hovered={hovered}
          onHover={(key) =>
            store.hover(key && byId.get(key)?.kind === 'node' ? key : null)
          }
          onPointerLeave={() => store.hover(null)}
          fixed={fixed}
          canPlace={canPlace}
        >
          {({ rows: shown }) => (
            <>
              {shown.map(({ key }) => {
                const row = byId.get(key);
                if (!row) return null;
                const Icon = row.kind === 'node' ? blockIcon(row.type) : null;
                return (
                  <Tree.Row
                    key={key}
                    value={key}
                    data-kind={row.kind}
                    className="ed-tree-item"
                  >
                    {row.kind === 'node' && row.hasChildren ? (
                      <Tree.Toggle value={key} className="ed-tree-toggle">
                        <ChevronRightIcon />
                      </Tree.Toggle>
                    ) : (
                      <span aria-hidden className="ed-tree-toggle" />
                    )}
                    {Icon ? <Icon aria-hidden /> : null}
                    <span className="ed-tree-text">{labelOf(row)}</span>
                    {row.kind === 'node' ? (
                      <>
                        <Editor.Slot
                          name="outline-row-actions"
                          props={{ blockId: row.id }}
                        />
                        <Tree.Handle value={key} className="ed-tree-handle">
                          <GripVerticalIcon />
                        </Tree.Handle>
                      </>
                    ) : null}
                  </Tree.Row>
                );
              })}
              <Tree.Instructions>
                Arrow keys move between blocks and select them, Right opens a
                block and Left closes it. Space picks a block up with everything
                in it; then Up and Down move it, Left and Right change its
                level, Space drops it and Escape puts it back.
              </Tree.Instructions>
            </>
          )}
        </Tree.Root>
      </div>
    </Chrome.Outline>
  );
}
