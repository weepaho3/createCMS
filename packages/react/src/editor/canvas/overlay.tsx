import * as React from 'react';
import { createPortal } from 'react-dom';

import type { UseRenderComponentProps } from '../../use-render';
import type { FlatNode } from '../core/document';
import type { ClampedEdges } from './anchors';
import type { CanvasRect } from './rect';

import { useRender } from '../../use-render';
import {
  useDocSelector,
  useSessionSelector,
  useEphemeralSelector,
} from '../binding';
import { computedStyleOf } from '../dom';
import { blockElements } from './anchors';
import { useCanvasContext } from './context';
import { useFieldRect, useMeasuredRect } from './rects';

type OverlayState = {
  editorOverlay: boolean;
};

/** The layer the nearest `Canvas.Overlay` draws on. */
export const OverlayLayerContext = React.createContext<'surface' | 'host'>(
  'surface',
);

export type CanvasOverlayProps = React.ComponentPropsWithRef<'div'> & {
  /**
   * `surface` (default) draws inside the canvas document, scrolling with
   * the content; `host` draws over a frame surface in the host page, for
   * chrome that may leave the frame (toolbars, menus). Inline canvases
   * have one layer, so `host` behaves like `surface` there.
   */
  layer?: 'surface' | 'host';
  render?: UseRenderComponentProps<'div', OverlayState>['render'];
};

export type CanvasRingState = {
  blockType: string | null;
  canMove: boolean;
  canDelete: boolean;
  unresolved: boolean;
  /** `block`, or `ref` for a reusable section. */
  kind: 'block' | 'ref';
  /** Edges an overflow ancestor cuts off (draw no line there). */
  clampedLeft: boolean;
  clampedTop: boolean;
  clampedRight: boolean;
  clampedBottom: boolean;
};

type SelectionRingState = CanvasRingState & {
  state: 'selected';
  editorSelectionRing: boolean;
};

type HoverRingState = CanvasRingState & {
  state: 'hover';
  editorHoverRing: boolean;
};

type ParentRingState = CanvasRingState & {
  state: 'parent';
  /** 1 for the direct parent of the selection, 2 for its parent, … */
  depth: number;
  editorParentRing: boolean;
};

type FieldRingState = CanvasRingState & {
  editorFieldRing: boolean;
};

export type CanvasSelectionRingProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', SelectionRingState>['render'];
};

export type CanvasHoverRingProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', HoverRingState>['render'];
};

export type CanvasParentRingProps = Omit<
  React.ComponentPropsWithRef<'div'>,
  'children'
> & {
  /** How many ancestors of the primary selection get a ring (default 1). */
  depth?: number;
  render?: UseRenderComponentProps<'div', ParentRingState>['render'];
};

export type CanvasFieldRingProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', FieldRingState>['render'];
};

/**
 * Position and size, also as `--x --y --w --h` and the block's own
 * corner radius as `--el-radius` for box-shadow rings; no transition on
 * any of them, so a ring never lags behind its block.
 */
function ringStyle(rect: CanvasRect, radius: string): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    boxSizing: 'border-box',
    pointerEvents: 'none',
    ['--x' as string]: `${rect.x}px`,
    ['--y' as string]: `${rect.y}px`,
    ['--w' as string]: `${rect.width}px`,
    ['--h' as string]: `${rect.height}px`,
    ['--el-radius' as string]: radius,
  };
}

function radiusOf(host: HTMLElement | null, id: string | null): string {
  const el = id && host ? blockElements(host, id)[0] : undefined;
  return (el ? computedStyleOf(el)?.borderRadius : undefined) ?? '0px';
}

type Clamped = { clamped?: ClampedEdges };

function ringFlags(
  host: HTMLElement | null,
  node: FlatNode | null,
  id: string | null,
  rect?: CanvasRect | null,
): CanvasRingState {
  const notRoot = node !== null && node.parent !== null;
  const clamped = (rect as (CanvasRect & Clamped) | null | undefined)?.clamped;
  return {
    blockType: node?.type ?? null,
    canMove: notRoot,
    canDelete: notRoot,
    kind: node?.type === '$ref' ? 'ref' : 'block',
    clampedLeft: clamped?.left ?? false,
    clampedTop: clamped?.top ?? false,
    clampedRight: clamped?.right ?? false,
    clampedBottom: clamped?.bottom ?? false,
    unresolved:
      id !== null && host !== null
        ? blockElements(host, id).some((el) =>
            el.hasAttribute('data-unresolved'),
          )
        : false,
  };
}

/**
 * Overlay is `pointer-events: none`; children that must receive pointer input
 * set `pointer-events: auto` on themselves. The primitive does not set
 * `position` on the host; the portal needs `position: relative` or similar
 * there so `absolute; inset: 0` covers the surface.
 */
export function CanvasOverlay({
  layer = 'surface',
  children,
  render,
  style,
  ...rest
}: CanvasOverlayProps) {
  const ctx = useCanvasContext('Canvas.Overlay');
  const innerRef = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const host = ctx.host;
    const inner = innerRef.current;
    const layer = inner?.parentElement;
    if (!host || !inner || !layer) return;
    // A positioned host is the layer's containing block: the layer
    // scrolls with the content already, and the host's overflow clips.
    if (layer.offsetParent === host) {
      inner.style.transform = '';
      layer.style.overflow = 'visible';
      return;
    }
    const apply = () => {
      inner.style.transform =
        'translate(' + -host.scrollLeft + 'px,' + -host.scrollTop + 'px)';
    };
    apply();
    host.addEventListener('scroll', apply);
    return () => {
      host.removeEventListener('scroll', apply);
    };
  }, [ctx.host]);

  // Over a frame, host-layer chrome may leave the frame (a toolbar above
  // the first block); the layer's own transform maps content coordinates.
  const hostLayer = useRender<'div', OverlayState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        pointerEvents: 'none',
        zIndex: 'var(--editor-z-overlay, 1)',
        ...style,
      },
      children,
    },
    state: { editorOverlay: true },
  });

  const surfaceLayer = useRender<'div', OverlayState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      style: {
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        // Clip scrolled-away chrome. BlockToolbar / DragHandle pin into the
        // visible intersection so the first block stays hittable.
        overflow: 'hidden',
        zIndex: 'var(--editor-z-overlay, 1)',
        ...style,
      },
      children: (
        <div
          ref={innerRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            willChange: 'transform',
          }}
        >
          {children}
        </div>
      ),
    },
    state: {
      editorOverlay: true,
    },
  });

  if (layer === 'host' && ctx.hostLayer) {
    return createPortal(
      <OverlayLayerContext.Provider value="host">
        {hostLayer}
      </OverlayLayerContext.Provider>,
      ctx.hostLayer,
    );
  }
  if (!ctx.host) return null;
  return createPortal(surfaceLayer, ctx.host);
}

export function CanvasSelectionRing({
  render,
  style,
  ...rest
}: CanvasSelectionRingProps) {
  const canvas = useCanvasContext('Canvas.SelectionRing');
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const node = useDocSelector((s) =>
    selected ? (s.nodes[selected] ?? null) : null,
  );
  const rect = useMeasuredRect(canvas.measurer, 'visible', selected ?? '');
  const flags = ringFlags(canvas.host, node, selected, rect);
  const element = useRender<'div', SelectionRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: rect
        ? { ...ringStyle(rect, radiusOf(canvas.host, selected)), ...style }
        : style,
    },
    state: { ...flags, state: 'selected', editorSelectionRing: true },
  });
  if (selected === null || rect === null) return null;
  return element;
}

export function CanvasHoverRing({
  render,
  style,
  ...rest
}: CanvasHoverRingProps) {
  const canvas = useCanvasContext('Canvas.HoverRing');
  const hovered = useEphemeralSelector((s) => s.hoverId);
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const node = useDocSelector((s) =>
    hovered ? (s.nodes[hovered] ?? null) : null,
  );
  const rect = useMeasuredRect(canvas.measurer, 'visible', hovered ?? '');
  const flags = ringFlags(canvas.host, node, hovered, rect);
  const element = useRender<'div', HoverRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: rect
        ? { ...ringStyle(rect, radiusOf(canvas.host, hovered)), ...style }
        : style,
    },
    state: { ...flags, state: 'hover', editorHoverRing: true },
  });
  if (canvas.dragging || canvas.editing) return null;
  if (hovered !== null && hovered === selected) return null;
  if (hovered === null || rect === null) return null;
  return element;
}

/**
 * The ancestors of the primary selection, nearest first, up to `depth`;
 * never the root.
 */
export function selectionAncestors(
  nodes: Readonly<Record<string, FlatNode>>,
  selected: string | null,
  depth: number,
): string[] {
  const out: string[] = [];
  let up = selected ? (nodes[selected]?.parent?.id ?? null) : null;
  while (up !== null && out.length < depth) {
    const parent = nodes[up]?.parent ?? null;
    if (parent === null) break;
    out.push(up);
    up = parent.id;
  }
  return out;
}

/**
 * One ring per ancestor of the primary selection (the container it sits
 * in), `data-depth` 1 for the direct parent. Hidden while dragging or
 * editing. Draw it under `Canvas.SelectionRing`, typically dashed.
 */
export function CanvasParentRing({
  depth = 1,
  ...props
}: CanvasParentRingProps) {
  const canvas = useCanvasContext('Canvas.ParentRing');
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const chain = useDocSelector((s) =>
    selectionAncestors(s.nodes, selected, depth).join('\0'),
  );
  if (canvas.dragging || canvas.editing || chain === '') return null;
  return chain
    .split('\0')
    .map((id, index) => (
      <ParentRingItem key={id} id={id} depth={index + 1} {...props} />
    ));
}

function ParentRingItem({
  id,
  depth,
  render,
  style,
  ...rest
}: Omit<CanvasParentRingProps, 'depth'> & { id: string; depth: number }) {
  const canvas = useCanvasContext('Canvas.ParentRing');
  const node = useDocSelector((s) => s.nodes[id] ?? null);
  const rect = useMeasuredRect(canvas.measurer, 'visible', id);
  const flags = ringFlags(canvas.host, node, id, rect);
  const element = useRender<'div', ParentRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: rect
        ? { ...ringStyle(rect, radiusOf(canvas.host, id)), ...style }
        : style,
    },
    state: { ...flags, state: 'parent', depth, editorParentRing: true },
  });
  if (rect === null) return null;
  return element;
}

export function CanvasFieldRing({
  render,
  style,
  ...rest
}: CanvasFieldRingProps) {
  const canvas = useCanvasContext('Canvas.FieldRing');
  // A field outside the selected block is no longer what the user works
  // on, even when it kept the store's field focus.
  const focus = useSessionSelector((s) =>
    s.focusedField && s.selection.includes(s.focusedField.blockId)
      ? s.focusedField
      : null,
  );
  const node = useDocSelector((s) =>
    focus ? (s.nodes[focus.blockId] ?? null) : null,
  );
  const rect = useFieldRect(focus?.blockId ?? '', focus?.key ?? '');
  const flags = ringFlags(canvas.host, node, focus?.blockId ?? null);
  const element = useRender<'div', FieldRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: rect ? { ...ringStyle(rect, '0px'), ...style } : style,
    },
    state: { ...flags, editorFieldRing: true },
  });
  if (focus === null || rect === null || canvas.dragging) return null;
  return element;
}
