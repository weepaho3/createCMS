import * as React from 'react';
import { createPortal } from 'react-dom';

import type { UseRenderComponentProps } from '../../use-render';
import type { FlatNode } from '../core/document';
import type { CanvasRect } from './rect';

import { useRender } from '../../use-render';
import {
  useDocSelector,
  useSessionSelector,
  useEphemeralSelector,
} from '../binding';
import { blockElements } from './anchors';
import { useCanvasContext } from './context';
import { useBlockRect, useFieldRect } from './rects';

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
};

type SelectionRingState = CanvasRingState & {
  editorSelectionRing: boolean;
};

type HoverRingState = CanvasRingState & {
  editorHoverRing: boolean;
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

export type CanvasFieldRingProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', FieldRingState>['render'];
};

function ringStyle(rect: CanvasRect): React.CSSProperties {
  return {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    boxSizing: 'border-box',
    pointerEvents: 'none',
  };
}

function ringFlags(
  host: HTMLElement | null,
  node: FlatNode | null,
  id: string | null,
): CanvasRingState {
  const notRoot = node !== null && node.parent !== null;
  return {
    blockType: node?.type ?? null,
    canMove: notRoot,
    canDelete: notRoot,
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
    if (!host || !inner) return;
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
  const rect = useBlockRect(selected ?? '');
  const flags = ringFlags(canvas.host, node, selected);
  const element = useRender<'div', SelectionRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: rect ? { ...ringStyle(rect), ...style } : style,
    },
    state: { ...flags, editorSelectionRing: true },
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
  const rect = useBlockRect(hovered ?? '');
  const flags = ringFlags(canvas.host, node, hovered);
  const element = useRender<'div', HoverRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: rect ? { ...ringStyle(rect), ...style } : style,
    },
    state: { ...flags, editorHoverRing: true },
  });
  if (canvas.dragging || canvas.editing) return null;
  if (hovered !== null && hovered === selected) return null;
  if (hovered === null || rect === null) return null;
  return element;
}

export function CanvasFieldRing({
  render,
  style,
  ...rest
}: CanvasFieldRingProps) {
  const canvas = useCanvasContext('Canvas.FieldRing');
  const focus = useSessionSelector((s) => s.focusedField);
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
      style: rect ? { ...ringStyle(rect), ...style } : style,
    },
    state: { ...flags, editorFieldRing: true },
  });
  if (focus === null || rect === null) return null;
  return element;
}
