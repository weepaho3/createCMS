'use client';

// @createcms/react/editor/canvas — live surface, overlay and interaction
// layer. The only entry that needs react-dom (portals); the peer is optional
// so form-only consumers never install it.
import { CanvasRoot } from './components';
import {
  CanvasFieldRing,
  CanvasHoverRing,
  CanvasOverlay,
  CanvasSelectionRing,
} from './overlay';

export type {
  CanvasInteractive,
  CanvasRootProps,
  CanvasSurface,
} from './components';
export type { CanvasComponent, CanvasComponents } from './map';
export type {
  CanvasFieldRingProps,
  CanvasHoverRingProps,
  CanvasOverlayProps,
  CanvasRingState,
  CanvasSelectionRingProps,
} from './overlay';
export type { CanvasRect } from './rect';
export type { CanvasResolve, ResolveKind } from './resolve';
export { useBlockRect, useFieldRect } from './rects';
export { useResolved } from './resolve';

export const Canvas = {
  Root: CanvasRoot,
  Overlay: CanvasOverlay,
  SelectionRing: CanvasSelectionRing,
  HoverRing: CanvasHoverRing,
  FieldRing: CanvasFieldRing,
};
