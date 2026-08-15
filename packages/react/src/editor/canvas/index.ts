'use client';

// @createcms/react/editor/canvas — live surface, overlay and interaction
// layer. Requires react-dom (portals) once the overlay lands; peer is optional
// so form-only consumers never install it.
import { CanvasRoot } from './components';

export type { CanvasRootProps } from './components';

export const Canvas = {
  Root: CanvasRoot,
};
