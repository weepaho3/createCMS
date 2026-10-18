import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { SlotRef } from '../core/document';

import { composeRefs, useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import { useDocSelector } from '../binding';
import { useEditorContext } from '../context';
import { insertionPoints } from '../core/insertion';
import { slotsOf } from '../core/schema';
import { useBlockActions } from '../hooks';

/** A slot a block may move into, as `useMoveTargets` lists it. */
export type MoveToTarget = {
  readonly parent: SlotRef;
  /** The parent's name (and the slot's, when the parent has several). */
  readonly label: string;
  /** Nesting depth of the parent (the root is 0). */
  readonly depth: number;
  /** Blocks in the slot without the moving one: positions run 1 to `count + 1`. */
  readonly count: number;
};

/**
 * Every slot `blockId` may move into, in document order, and `moveTo` to
 * put it at a position there: the logic of a move-to dialog, the non-drag
 * way to restructure a page.
 */
export function useMoveTargets(blockId: string): {
  readonly targets: readonly MoveToTarget[];
  moveTo(parent: SlotRef, index: number): boolean;
} {
  const { schema, messages } = useEditorContext('useMoveTargets');
  const actions = useBlockActions(blockId);
  const targets = useDocSelector(
    (state) => {
      const node = state.nodes[blockId];
      if (!node || node.parent === null) return [];
      const seen = new Set<string>();
      const out: MoveToTarget[] = [];
      for (const point of insertionPoints(
        schema,
        state.nodes,
        state.rootId,
        node.type,
        blockId,
      )) {
        const key = `${point.parent.id}:${point.parent.slot}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const parent = state.nodes[point.parent.id];
        if (!parent) continue;
        let depth = 0;
        for (
          let up = parent.parent;
          up;
          up = state.nodes[up.id]?.parent ?? null
        ) {
          depth += 1;
        }
        const slots = slotsOf(schema, parent.type);
        const described = describeBlock(schema, parent);
        const name =
          point.parent.id === state.rootId
            ? messages.announce.root
            : described.excerpt
              ? `${described.label} "${described.excerpt}"`
              : described.label;
        const slotLabel =
          Object.keys(slots).length > 1
            ? (slots[point.parent.slot]?.label ?? point.parent.slot)
            : null;
        out.push({
          parent: point.parent,
          label: slotLabel ? `${name}: ${slotLabel}` : name,
          depth,
          count: (parent.slots[point.parent.slot] ?? []).filter(
            (id) => id !== blockId,
          ).length,
        });
      }
      return out;
    },
    (a, b) =>
      a.length === b.length &&
      a.every(
        (entry, i) =>
          entry.label === b[i]!.label &&
          entry.count === b[i]!.count &&
          entry.parent.id === b[i]!.parent.id &&
          entry.parent.slot === b[i]!.parent.slot,
      ),
  );
  return { targets, moveTo: actions.moveTo };
}

type MoveToDialogState = { step: 'slot' | 'position' };

export type EditorMoveToDialogProps = Omit<
  UseRenderComponentProps<'div', MoveToDialogState>,
  'children'
> & {
  /** The block to move. */
  blockId: string;
  /** Closes the dialog (after a move, on Escape or Back from the first step). */
  onClose: () => void;
};

/**
 * Moves a block without dragging: pick a slot from every place the block
 * may go, then a position in it. A `role="dialog"` with buttons; Escape
 * closes it.
 */
export function EditorMoveToDialog(props: EditorMoveToDialogProps) {
  const { blockId, onClose, render, onKeyDown, ref, ...rest } = props;
  const { schema, messages, store } = useEditorContext('Editor.MoveToDialog');
  const { targets, moveTo } = useMoveTargets(blockId);
  const [chosen, setChosen] = React.useState<MoveToTarget | null>(null);
  const titleId = React.useId();
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const node = store.getDoc().nodes[blockId];
  const title = node
    ? messages.parts.moveToTitle({ block: describeBlock(schema, node) })
    : messages.parts.moveTo;

  React.useEffect(() => {
    elRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, [chosen]);

  const content =
    chosen === null ? (
      <ul>
        {targets.map((target) => (
          <li
            key={`${target.parent.id}:${target.parent.slot}`}
            data-depth={target.depth}
          >
            <button type="button" onClick={() => setChosen(target)}>
              {target.label}
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <>
        <button type="button" onClick={() => setChosen(null)}>
          {messages.parts.moveToBack}
        </button>
        <ul>
          {Array.from({ length: chosen.count + 1 }, (_, index) => (
            <li key={index}>
              <button
                type="button"
                onClick={() => {
                  if (moveTo(chosen.parent, index)) onClose();
                }}
              >
                {messages.parts.moveToPosition({
                  position: index + 1,
                  count: chosen.count + 1,
                })}
              </button>
            </li>
          ))}
        </ul>
      </>
    );

  return useRender<'div', MoveToDialogState>({
    defaultTagName: 'div',
    render,
    props: {
      role: 'dialog',
      'aria-labelledby': titleId,
      ...rest,
      ref: composeRefs(elRef, ref),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== 'Escape') return;
        event.preventDefault();
        onClose();
      },
      children: (
        <>
          <h2 id={titleId}>{title}</h2>
          {content}
        </>
      ),
    },
    state: { step: chosen === null ? 'slot' : 'position' },
  });
}
