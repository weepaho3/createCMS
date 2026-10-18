'use client';

import { CanvasBlockError, CanvasUnknownBlock } from './boundary';
// @createcms/react/editor/canvas: live surface, overlay and interaction
// layer. The only entry that needs react-dom (portals); the peer is optional
// so form-only consumers never install it.
import { CanvasRoot } from './components';
import { CanvasContextMenu } from './context-menu';
import {
  CanvasDragHandle,
  CanvasDragPreview,
  CanvasDropIndicator,
  CanvasDropTargetRing,
  CanvasPaletteItem,
} from './dnd-parts';
import { CanvasInlineText } from './inline-parts';
import {
  CanvasFieldRing,
  CanvasHoverRing,
  CanvasOverlay,
  CanvasSelectionRing,
} from './overlay';
import { CanvasProvider } from './provider';
import { CanvasReadonlySubtree } from './readonly';
import { CanvasBlockToolbar, CanvasInsertButton } from './toolbar';

export type {
  CanvasInteractive,
  CanvasRootProps,
  CanvasSurface,
} from './components';
export type { CanvasProviderProps } from './provider';
export type { CanvasClickToEdit } from './context';
export type { CanvasContextMenuProps, ContextMenuEntry } from './context-menu';
export { CONTEXT_MENU_COMMANDS } from './context-menu';
export { createSectionRefBlock } from './section-ref';
export type { CanvasFileDrop } from './file-drop';
export { useSurface } from './context';
export type { PreviewSurface, SurfacePoint, SurfaceRect } from './surface';
export type {
  CanvasFrameOptions,
  CanvasFrameWrapper,
} from './frame/frame-shell';
export { emailFrame } from './frame/presets';
export type { Breakpoint } from './frame/viewport';
export {
  breakpointFor,
  DEFAULT_BREAKPOINTS,
  fitScale,
  MAX_AUTO_HEIGHT,
} from './frame/viewport';
export {
  depthParent,
  isSelectionClick,
  rangeSelection,
  toggledSelection,
} from './interact';
export type {
  CanvasComponent,
  CanvasComponentProps,
  CanvasComponents,
} from './map';
export type { CanvasReadonlySubtreeProps } from './readonly';
export type { EditableField } from './editable-field';
export { useEditableField } from './editable-field';
export type { PlainTextOptions } from './plain-text';
export { normalizePlainText } from './plain-text';
export type {
  BlockErrorBoundaryProps,
  CanvasBlockErrorProps,
  CanvasUnknownBlockProps,
} from './boundary';
export { BlockErrorBoundary } from './boundary';
export type { BlockErrorInfo, UnknownBlockInfo } from './renderer';
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
  CanvasDragHandleProps,
  CanvasDragPreviewProps,
  CanvasDropIndicatorProps,
  CanvasDropTargetRingProps,
  CanvasPaletteItemProps,
} from './dnd-parts';
export type {
  CanvasInlineTextProps,
  InlineSuggest,
  InlineSuggestItem,
  InlineSuggestRenderContext,
} from './inline-parts';
export type {
  CanvasFieldRingProps,
  CanvasHoverRingProps,
  CanvasOverlayProps,
  CanvasRingState,
  CanvasSelectionRingProps,
} from './overlay';
export type { CanvasRect } from './rect';
export type { CanvasResolve, FieldResolver } from './resolve';
export type { PointerSnapshot, PointerStore } from './pointer';
export type { DragSession } from './dnd';
export { useBlockRect, useFieldRect } from './rects';
export { useResolved } from './resolve';
export {
  INSERT_BOX_PAD,
  INSERT_LINE_THICKNESS,
  resolveInsertAt,
} from './insert';
export { adjustMoveIndex, blockIdAtPoint, DND_THRESHOLD_PX } from './dnd';
export {
  applyTextEdit,
  EMPTY_FIELD_PLACEHOLDER,
  isInlineEditableKind,
} from './inline-text';
export { useInsertTarget } from './toolbar';

export const Canvas = {
  Provider: CanvasProvider,
  Root: CanvasRoot,
  Overlay: CanvasOverlay,
  SelectionRing: CanvasSelectionRing,
  HoverRing: CanvasHoverRing,
  FieldRing: CanvasFieldRing,
  BlockToolbar: CanvasBlockToolbar,
  InsertButton: CanvasInsertButton,
  DragHandle: CanvasDragHandle,
  PaletteItem: CanvasPaletteItem,
  DropIndicator: CanvasDropIndicator,
  DropTargetRing: CanvasDropTargetRing,
  DragPreview: CanvasDragPreview,
  InlineText: CanvasInlineText,
  ReadonlySubtree: CanvasReadonlySubtree,
  BlockError: CanvasBlockError,
  UnknownBlock: CanvasUnknownBlock,
  ContextMenu: CanvasContextMenu,
};
