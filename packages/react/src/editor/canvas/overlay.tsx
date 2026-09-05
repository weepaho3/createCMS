import * as React from 'react';
import { createPortal } from 'react-dom';

import type { UseRenderComponentProps } from '../../use-render';
import type { EditorNode } from '../store';
import type { CanvasRect } from './rect';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { blockElements } from './anchors';
import { useCanvasContext } from './context';
import { useBlockRect, useFieldRect } from './rects';

type OverlayState = {
  editorOverlay: boolean;
};

export type CanvasOverlayProps = React.ComponentPropsWithRef<'div'> & {
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
  node: EditorNode | null,
  id: string | null,
): CanvasRingState {
  const notRoot = node !== null && node.parentId !== null;
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

  const layer = useRender<'div', OverlayState>({
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

  if (!ctx.host) return null;
  return createPortal(layer, ctx.host);
}

export function CanvasSelectionRing({
  render,
  style,
  ...rest
}: CanvasSelectionRingProps) {
  const canvas = useCanvasContext('Canvas.SelectionRing');
  const { userId } = useEditorContext('Canvas.SelectionRing');
  const selected = useEditorSelector(
    (s) => s.selection[userId]?.selected ?? null,
  );
  const node = useEditorSelector((s) =>
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
  const { userId } = useEditorContext('Canvas.HoverRing');
  const hovered = useEditorSelector(
    (s) => s.selection[userId]?.hovered ?? null,
  );
  const selected = useEditorSelector(
    (s) => s.selection[userId]?.selected ?? null,
  );
  const node = useEditorSelector((s) =>
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
  const { userId } = useEditorContext('Canvas.FieldRing');
  const focus = useEditorSelector((s) => s.selection[userId]?.focus ?? null);
  const node = useEditorSelector((s) =>
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
