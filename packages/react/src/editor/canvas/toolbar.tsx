import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { FieldRef } from '../core/store';
import type { PreviewSurface } from './surface';

import { composeRefs, useRender } from '../../use-render';
import {
  useDocSelector,
  useSessionSelector,
  useEphemeralSelector,
} from '../binding';
import { useEditorContext } from '../context';
import { canPlaceIn } from '../core/schema';
import { isHTMLElement } from '../dom';
import { useRovingFocus } from '../roving';
import { useCanvasContext } from './context';
import {
  type InsertTarget,
  resolveInsertAt,
  type InsertOrientation,
} from './insert';
import { createInsertAdapters } from './insert-dom';
import { OverlayLayerContext } from './overlay';
import {
  OVERLAY_TOOLBAR_ESTIMATE_PX,
  overlayChromeFitsAbove,
  overlayChromeFitsBelow,
  visibleIntersection,
} from './rect';
import { useBlockRect, useHostViewBox } from './rects';

const subscribeNoop = () => () => {};

function sameTarget(a: InsertTarget, b: InsertTarget): boolean {
  const ar = a.rect;
  const br = b.rect;
  return (
    a.parent.id === b.parent.id &&
    a.parent.slot === b.parent.slot &&
    a.index === b.index &&
    ar.x === br.x &&
    ar.y === br.y &&
    ar.width === br.width &&
    ar.height === br.height
  );
}

export function useInsertTarget(options?: {
  type?: string;
  draggedId?: string;
}): InsertTarget | null {
  const canvas = useCanvasContext('useInsertTarget');
  const { schema } = useEditorContext('useInsertTarget');
  const rootId = useDocSelector((s) => s.rootId);
  const nodes = useDocSelector((s) => s.nodes);
  const hovered = useEphemeralSelector((s) => s.hoverId);

  const { measurer, host, pointer, interactive, dragging, editing } = canvas;
  const pointerSnap = React.useSyncExternalStore(
    pointer ? pointer.subscribe : subscribeNoop,
    () => (pointer ? pointer.getSnapshot() : null),
    () => null,
  );

  const prevRef = React.useRef<InsertTarget | null>(null);

  if (
    interactive !== 'edit' ||
    dragging ||
    editing ||
    hovered === null ||
    pointerSnap === null ||
    !measurer ||
    !host
  ) {
    prevRef.current = null;
    return null;
  }

  const adapters = createInsertAdapters(host, measurer, nodes, rootId);

  const next = resolveInsertAt(
    schema,
    nodes,
    rootId,
    hovered,
    pointerSnap.x,
    pointerSnap.y,
    {
      draggedType: options?.type,
      draggedId: options?.draggedId,
      getRect: adapters.getRect,
      getSlotRect: adapters.getSlotRect,
      isRowFlow: adapters.isRowFlow,
    },
  );

  if (next === null) {
    prevRef.current = null;
    return null;
  }

  const prev = prevRef.current;
  if (prev && sameTarget(prev, next)) return prev;
  prevRef.current = next;
  return next;
}

const TOOLBAR_SCROLL_IDLE_MS = 150;

/** True when a DragHandle is rendered inside BlockToolbar (in-flow). */
export const BlockToolbarContext = React.createContext(false);

type BlockToolbarState = {
  editorBlockToolbar: boolean;
  side: 'top' | 'bottom';
  blockType: string | null;
  /** No room outside the block: the toolbar sits inside its edge. */
  flipped: boolean;
  /** On the host layer while the canvas scrolls (hidden until 150 ms after). */
  scrolling: boolean;
};

export type CanvasBlockToolbarProps = React.ComponentPropsWithRef<'div'> & {
  /** `start` and `end` follow `Editor.Root`'s `dir`. */
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  offset?: number;
  render?: UseRenderComponentProps<'div', BlockToolbarState>['render'];
};

/**
 * Whether host-layer chrome beside block `id` stays in sight: the page
 * around a frame may clip it (a scroll container under an app bar), so the
 * space above (or below) the block must lie inside every clipping
 * ancestor of the frame.
 */
function hostChromeFits(
  surface: PreviewSurface | null,
  id: string | null,
  side: 'top' | 'bottom',
  offset: number,
): { fits: boolean; hiddenTop: number } {
  const all = { fits: true, hiddenTop: 0 };
  const frame = surface?.window.frameElement;
  if (!surface || surface.kind !== 'frame' || !frame || id === null) {
    return all;
  }
  const el = surface.getElementsForNode(id)[0];
  if (!el) return all;
  const box = el.getBoundingClientRect();
  const block = surface.toHost({
    x: box.left,
    y: box.top,
    width: box.width,
    height: box.height,
  });
  const view = frame.ownerDocument.defaultView;
  if (!view) return all;
  let top = 0;
  let bottom = view.innerHeight;
  for (let cur = frame.parentElement; cur; cur = cur.parentElement) {
    const style = view.getComputedStyle(cur);
    if (style.overflowY === 'visible' && style.overflowX === 'visible') {
      continue;
    }
    const clip = cur.getBoundingClientRect();
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
  }
  const room = OVERLAY_TOOLBAR_ESTIMATE_PX + offset;
  return {
    fits:
      side === 'bottom'
        ? block.y + block.height + room <= bottom
        : block.y - room >= top,
    // How much of the block's top the page hides, in canvas pixels.
    hiddenTop: Math.max(0, (top - block.y) / (surface.scale || 1)),
  };
}

export function CanvasBlockToolbar({
  align = 'start',
  side = 'top',
  offset = 0,
  children,
  render,
  style,
  ref,
  onKeyDown,
  onFocus,
  ...rest
}: CanvasBlockToolbarProps) {
  const canvas = useCanvasContext('Canvas.BlockToolbar');
  const { dir, store, schema, messages } = useEditorContext(
    'Canvas.BlockToolbar',
  );
  const roving = useRovingFocus<HTMLDivElement>({ dir });
  // Where Alt+F10 came from, so Escape can return there.
  const returnRef = React.useRef<{
    el: HTMLElement | null;
    editing: FieldRef | null;
  } | null>(null);
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const node = useDocSelector((s) =>
    selected ? (s.nodes[selected] ?? null) : null,
  );
  const rect = useBlockRect(selected ?? '');
  const view = useHostViewBox(canvas.host);

  const active =
    Boolean(canvas.host) &&
    canvas.interactive !== 'none' &&
    selected !== null &&
    rect !== null;
  const frameRect = rect ?? { x: 0, y: 0, width: 0, height: 0 };

  const vis = visibleIntersection(frameRect, view) ?? frameRect;

  // `start`/`end` follow the editor's text direction.
  const rtl = dir === 'rtl';
  const alignStyle: React.CSSProperties =
    align === 'center'
      ? { left: '50%', transform: 'translateX(-50%)' }
      : (align === 'end') !== rtl
        ? { right: 0 }
        : { left: 0 };

  // On the host layer over a frame the toolbar may leave the frame.
  const onHostLayer = React.useContext(OverlayLayerContext) === 'host';
  // Host-layer chrome cannot follow a scrolling frame frame by frame: it
  // hides while the canvas scrolls and returns 150 ms after.
  const [scrolling, setScrolling] = React.useState(false);
  React.useEffect(() => {
    const doc = canvas.host?.ownerDocument;
    if (!onHostLayer || !doc) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      setScrolling(true);
      clearTimeout(timer);
      timer = setTimeout(() => setScrolling(false), TOOLBAR_SCROLL_IDLE_MS);
    };
    doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      clearTimeout(timer);
      doc.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [onHostLayer, canvas.host]);
  const host = onHostLayer
    ? hostChromeFits(canvas.surface, selected, side, offset)
    : null;
  const fitsOutside = host
    ? host.fits
    : side === 'bottom'
      ? overlayChromeFitsBelow(frameRect, view, offset)
      : overlayChromeFitsAbove(frameRect, view, offset);

  const sideStyle: React.CSSProperties = fitsOutside
    ? side === 'bottom'
      ? { top: '100%', marginTop: offset }
      : { bottom: '100%', marginBottom: offset }
    : { top: offset, marginTop: 0 };

  const rovingFocus = roving.focus;
  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action !== 'toolbar') return;
        const active = canvas.host?.ownerDocument.activeElement ?? null;
        returnRef.current = {
          el: isHTMLElement(active) ? active : null,
          editing: store.getSession().editing,
        };
        rovingFocus();
      }),
    [store, canvas.host, rovingFocus],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      const back = returnRef.current;
      returnRef.current = null;
      event.preventDefault();
      if (back?.el?.isConnected) back.el.focus();
      else if (back?.editing) {
        store.focus(back.editing);
        store.setEditing(back.editing);
      } else canvas.host?.focus();
      return;
    }
    roving.onKeyDown(event);
  };

  const blockLabel = node
    ? (schema.components[node.type]?.label ?? node.type)
    : '';

  const chrome = useRender<'div', BlockToolbarState>({
    defaultTagName: 'div',
    render,
    props: {
      'aria-label': messages.parts.blockToolbar({ label: blockLabel }),
      ...rest,
      ref: composeRefs(roving.ref, ref),
      onKeyDown: handleKeyDown,
      onFocus: (event: React.FocusEvent<HTMLDivElement>) => {
        onFocus?.(event);
        roving.onFocus(event);
      },
      role: 'toolbar',
      style: {
        position: 'absolute',
        pointerEvents: 'auto',
        ...sideStyle,
        ...alignStyle,
        ...style,
      },
      children,
    },
    state: {
      editorBlockToolbar: true,
      side,
      blockType: node?.type ?? null,
      flipped: !fitsOutside,
      scrolling,
    },
  });

  if (!active) return null;
  // Inside the block, the toolbar sits at the top the page leaves visible.
  const hidden = Math.min(host?.hiddenTop ?? 0, frameRect.height);
  const frame = fitsOutside
    ? frameRect
    : host
      ? {
          x: frameRect.x,
          y: frameRect.y + hidden,
          width: frameRect.width,
          height: frameRect.height - hidden,
        }
      : vis;

  return (
    <div
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      <BlockToolbarContext.Provider value={true}>
        {chrome}
      </BlockToolbarContext.Provider>
    </div>
  );
}

type InsertButtonState = {
  editorInsertButton: boolean;
  orientation: InsertOrientation;
  emptyContainer: boolean;
  allowedChildTypes?: string[];
};

export type CanvasInsertButtonProps = Omit<
  React.ComponentPropsWithRef<'button'>,
  'type'
> & {
  /** How long the pointer rests at a gap before the button shows. Default 400 ms. */
  delay?: number;
  placement: 'between' | 'container';
  type?: string;
  onInsert?: (target: InsertTarget) => void;
  render?: UseRenderComponentProps<'button', InsertButtonState>['render'];
};

/** The pointer rests this long at a gap before `Canvas.InsertButton` shows. */
export const INSERT_BUTTON_DELAY_MS = 400;

export function CanvasInsertButton({
  delay = INSERT_BUTTON_DELAY_MS,
  placement,
  type,
  onInsert,
  onClick,
  render,
  style,
  children,
  ...rest
}: CanvasInsertButtonProps) {
  useCanvasContext('Canvas.InsertButton');
  const ctx = useEditorContext('Canvas.InsertButton');
  const target = useInsertTarget();
  const refused = useDocSelector(
    (s) =>
      target !== null &&
      type !== undefined &&
      !canPlaceIn(ctx.schema, s.nodes, type, target.parent).ok,
  );

  const active =
    target !== null &&
    (placement === 'between'
      ? target.variant === 'line'
      : target.variant === 'box');

  const disabled = refused;

  // Show only after the pointer rested at the same gap for `delay`.
  const gapKey = target
    ? `${target.parent.id}:${target.parent.slot}:${target.index}:${target.variant}`
    : null;
  const [shownKey, setShownKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (gapKey === null) return;
    if (delay <= 0) {
      setShownKey(gapKey);
      return;
    }
    const timer = setTimeout(() => setShownKey(gapKey), delay);
    return () => clearTimeout(timer);
  }, [gapKey, delay]);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (target === null) return;
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (type) {
      ctx.store.add(type, {
        parent: target.parent,
        index: target.index,
      });
    } else {
      onInsert?.(target);
    }
  };

  const allowedTypes = target ? [...target.allowedTypes] : [];

  const element = useRender<'button', InsertButtonState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      disabled,
      onClick: handleClick,
      ...rest,
      style: {
        position: 'absolute',
        left: target ? target.rect.x + target.rect.width / 2 : 0,
        top: target ? target.rect.y + target.rect.height / 2 : 0,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        ...style,
      },
      children,
    },
    state: {
      editorInsertButton: true,
      orientation: target?.orientation ?? 'horizontal',
      emptyContainer: target?.variant === 'box',
      allowedChildTypes: allowedTypes,
    },
  });
  if (!active || (delay > 0 && shownKey !== gapKey)) return null;
  return element;
}
