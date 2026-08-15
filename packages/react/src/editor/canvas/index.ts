'use client';

// @createcms/react/editor/canvas — live surface, overlay and interaction
// layer. The only entry that needs react-dom (portals); the peer is optional
// so form-only consumers never install it.
import { CanvasRoot } from './components';

export type { CanvasRootProps } from './components';

export const Canvas = {
  Root: CanvasRoot,
};
