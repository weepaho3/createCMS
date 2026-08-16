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
import { CanvasBlockToolbar, CanvasInsertButton } from './toolbar';

export type {
  CanvasInteractive,
  CanvasRootProps,
  CanvasSurface,
} from './components';
export type { CanvasComponent, CanvasComponents } from './map';
export type {
  InsertOrientation,
  InsertTarget,
  InsertVariant,
  ResolveInsertAtOptions,
} from './insert';
export type {
  CanvasBlockToolbarProps,
  CanvasInsertButtonProps,
} from './toolbar';
export type {
  CanvasFieldRingProps,
  CanvasHoverRingProps,
  CanvasOverlayProps,
  CanvasRingState,
  CanvasSelectionRingProps,
} from './overlay';
export type { CanvasRect } from './rect';
export type { CanvasResolve, ResolveKind } from './resolve';
export type { PointerSnapshot, PointerStore } from './pointer';
export { useBlockRect, useFieldRect } from './rects';
export { useResolved } from './resolve';
export {
  INSERT_BOX_PAD,
  INSERT_LINE_THICKNESS,
  resolveInsertAt,
} from './insert';
export { useInsertTarget } from './toolbar';

export const Canvas = {
  Root: CanvasRoot,
  Overlay: CanvasOverlay,
  SelectionRing: CanvasSelectionRing,
  HoverRing: CanvasHoverRing,
  FieldRing: CanvasFieldRing,
  BlockToolbar: CanvasBlockToolbar,
  InsertButton: CanvasInsertButton,
};
