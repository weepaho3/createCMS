import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { FlatNode } from '../core/document';

import { useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import {
  useDocSelector,
  useEphemeralSelector,
  useSessionSelector,
} from '../binding';
import { useEditorContext } from '../context';
import { computedStyleOf } from '../dom';
import { blockElements } from './anchors';
import { CanvasContext, useCanvasContext } from './context';
import { useCanvasSession } from './provider';
import { useHostViewBox, useMeasuredRect } from './rects';

const subscribeNoop = () => () => {};

/** Height the label reserves when deciding where it fits. */
export const LABEL_HEIGHT_PX = 20;
/** Blocks shorter than this get the label below when it does not fit above. */
const LABEL_BELOW_MAX_PX = 250;

/**
 * Where the selected block's label goes: above when it fits between the
 * block and the top of the visible canvas, else below a block shorter than
 * 250 px, else inside its top edge.
 */
export function labelPlacement(
  rect: { y: number; height: number },
  viewTop: number,
  labelHeight = LABEL_HEIGHT_PX,
): 'above' | 'below' | 'inside' {
  if (labelHeight <= rect.y - viewTop) return 'above';
  if (rect.height < LABEL_BELOW_MAX_PX) return 'below';
  return 'inside';
}

type LabelState = { placement: 'above' | 'below' | 'inside'; open: boolean };

export type CanvasLabelProps = UseRenderComponentProps<'div', LabelState>;

/**
 * The selected block's name at its edge (above, below or inside, as fits).
 * Clicking it opens a breadcrumb of its parent and grandparent: a click
 * selects that ancestor, hovering one highlights it.
 */
export function CanvasLabel({ render, style, ...rest }: CanvasLabelProps) {
  const canvas = useCanvasContext('Canvas.Label');
  const { store, schema, messages } = useEditorContext('Canvas.Label');
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const rect = useMeasuredRect(canvas.measurer, 'block', selected ?? '');
  const view = useHostViewBox(canvas.host);
  const [open, setOpen] = React.useState(false);
  const chain = useDocSelector(
    (state) => {
      const out: Array<{ id: string; label: string }> = [];
      const node = selected ? state.nodes[selected] : undefined;
      if (!node || node.parent === null) return out;
      out.push({ id: node.id, label: describeBlock(schema, node).label });
      let up: FlatNode | undefined = state.nodes[node.parent.id];
      for (
        ;
        up && out.length < 3;
        up = up.parent ? state.nodes[up.parent.id] : undefined
      ) {
        out.push({
          id: up.id,
          label:
            up.id === state.rootId
              ? messages.announce.root
              : describeBlock(schema, up).label,
        });
      }
      return out;
    },
    (a, b) =>
      a.length === b.length &&
      a.every(
        (entry, i) => entry.id === b[i]!.id && entry.label === b[i]!.label,
      ),
  );

  React.useEffect(() => setOpen(false), [selected]);

  const placement = rect ? labelPlacement(rect, view.scrollTop) : 'above';
  const top = !rect
    ? 0
    : placement === 'above'
      ? rect.y - LABEL_HEIGHT_PX
      : placement === 'below'
        ? rect.y + rect.height
        : rect.y;

  const element = useRender<'div', LabelState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      style: {
        position: 'absolute',
        left: rect?.x ?? 0,
        top,
        minHeight: LABEL_HEIGHT_PX,
        pointerEvents: 'auto',
        ...style,
      },
      children: (
        <>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {chain[0]?.label}
          </button>
          {open ? (
            <ol data-editor-label-breadcrumb="">
              {chain.slice(1).map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      if (entry.id !== store.getDoc().rootId) {
                        store.select(entry.id);
                      }
                    }}
                    onPointerEnter={() => store.hover(entry.id)}
                    onPointerLeave={() => store.hover(null)}
                    onFocus={() => store.hover(entry.id)}
                    onBlur={() => store.hover(null)}
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ),
    },
    state: { placement, open },
  });
  if (!selected || !rect || chain.length === 0) return null;
  return element;
}

type EmptySlotState = { editorEmptySlot: boolean; dragOver: boolean };

export type CanvasEmptySlotProps = UseRenderComponentProps<
  'div',
  EmptySlotState
> & {
  /** The block whose slot this placeholder fills. */
  blockId: string;
  /** The slot; default `children`. */
  slot?: string;
  /** Runs on the add button; default: select the block and open quick insert. */
  onAdd?: () => void;
};

/**
 * A placeholder for an empty slot inside a block component: a minimum
 * height to drop into, `data-drag-over` while a drag targets it, and an
 * add button. Render it next to the slot's children: it shows only while
 * the slot is empty, and only in an editing canvas.
 */
export function CanvasEmptySlot({
  blockId,
  slot = 'children',
  onAdd,
  render,
  style,
  children,
  ...rest
}: CanvasEmptySlotProps) {
  const canvas = React.useContext(CanvasContext);
  const { store, messages } = useEditorContext('Canvas.EmptySlot');
  const session = useCanvasSession('Canvas.EmptySlot');
  const empty = useDocSelector(
    (state) => (state.nodes[blockId]?.slots[slot]?.length ?? 0) === 0,
  );
  const dragOver = React.useSyncExternalStore(
    session.dnd.subscribeTarget,
    () => {
      const target = session.dnd.getDropTarget();
      return (
        target !== null &&
        target.parent.id === blockId &&
        target.parent.slot === slot
      );
    },
    () => false,
  );
  const element = useRender<'div', EmptySlotState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      style: {
        minHeight: 'var(--editor-empty-slot-min-height, 64px)',
        ...style,
      },
      children: children ?? (
        <button
          type="button"
          onClick={() => {
            if (onAdd) {
              onAdd();
              return;
            }
            store.select(blockId);
            store.commands.execute('ui.quickInsert');
          }}
        >
          {messages.parts.emptySlotAdd}
        </button>
      ),
    },
    state: { editorEmptySlot: true, dragOver },
  });
  if (canvas?.interactive !== 'edit' || !empty) return null;
  return element;
}

type SpacingState = { blockId: string };

export type CanvasSpacingOverlayProps = UseRenderComponentProps<
  'div',
  SpacingState
> & {
  /**
   * The block to show; default: the hovered block while Alt and Shift are
   * held.
   */
  blockId?: string | null;
};

function boxSides(style: CSSStyleDeclaration, prefix: 'padding' | 'margin') {
  const read = (side: string) =>
    Number.parseFloat(style.getPropertyValue(`${prefix}-${side}`)) || 0;
  return {
    top: read('top'),
    right: read('right'),
    bottom: read('bottom'),
    left: read('left'),
  };
}

/**
 * Shows a block's padding and margin as tinted strips (`data-box="padding"`
 * or `"margin"`, `data-side`), for spacing fields or an Alt+Shift hover.
 */
export function CanvasSpacingOverlay({
  blockId: blockIdProp,
  render,
  style,
  ...rest
}: CanvasSpacingOverlayProps) {
  const canvas = useCanvasContext('Canvas.SpacingOverlay');
  const hovered = useEphemeralSelector((s) => s.hoverId);
  const [modifier, setModifier] = React.useState(false);
  React.useEffect(() => {
    const doc = canvas.host?.ownerDocument;
    if (!doc || blockIdProp !== undefined) return;
    const update = (event: KeyboardEvent) =>
      setModifier(event.altKey && event.shiftKey);
    doc.addEventListener('keydown', update);
    doc.addEventListener('keyup', update);
    return () => {
      doc.removeEventListener('keydown', update);
      doc.removeEventListener('keyup', update);
    };
  }, [canvas.host, blockIdProp]);
  const blockId =
    blockIdProp !== undefined ? blockIdProp : modifier ? hovered : null;
  const rect = useMeasuredRect(canvas.measurer, 'block', blockId ?? '');
  const sides = React.useSyncExternalStore(
    canvas.measurer ? canvas.measurer.subscribe : subscribeNoop,
    () => {
      const el =
        blockId && canvas.host ? blockElements(canvas.host, blockId)[0] : null;
      const computed = el ? computedStyleOf(el) : null;
      if (!computed) return null;
      const key = `${computed.padding}|${computed.margin}`;
      return key;
    },
    () => null,
  );
  const strips = React.useMemo(() => {
    const el =
      blockId && canvas.host ? blockElements(canvas.host, blockId)[0] : null;
    const computed = el ? computedStyleOf(el) : null;
    if (!computed || !rect || sides === null) return [];
    const padding = boxSides(computed, 'padding');
    const margin = boxSides(computed, 'margin');
    const { x, y, width, height } = rect;
    return [
      { box: 'padding', side: 'top', x, y, width, height: padding.top },
      {
        box: 'padding',
        side: 'bottom',
        x,
        y: y + height - padding.bottom,
        width,
        height: padding.bottom,
      },
      { box: 'padding', side: 'left', x, y, width: padding.left, height },
      {
        box: 'padding',
        side: 'right',
        x: x + width - padding.right,
        y,
        width: padding.right,
        height,
      },
      {
        box: 'margin',
        side: 'top',
        x,
        y: y - margin.top,
        width,
        height: margin.top,
      },
      {
        box: 'margin',
        side: 'bottom',
        x,
        y: y + height,
        width,
        height: margin.bottom,
      },
      {
        box: 'margin',
        side: 'left',
        x: x - margin.left,
        y,
        width: margin.left,
        height,
      },
      {
        box: 'margin',
        side: 'right',
        x: x + width,
        y,
        width: margin.right,
        height,
      },
    ].filter((strip) => strip.width > 0 && strip.height > 0);
  }, [blockId, canvas.host, rect, sides]);

  const element = useRender<'div', SpacingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        ...style,
      },
      children: strips.map((strip) => (
        <div
          key={`${strip.box}-${strip.side}`}
          data-box={strip.box}
          data-side={strip.side}
          style={{
            position: 'absolute',
            left: strip.x,
            top: strip.y,
            width: strip.width,
            height: strip.height,
          }}
        />
      )),
    },
    state: { blockId: blockId ?? '' },
  });
  if (!blockId || strips.length === 0) return null;
  return element;
}
