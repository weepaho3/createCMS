import { blockElements } from './anchors';

/** A point in client coordinates of some document. */
export type SurfacePoint = { readonly x: number; readonly y: number };

/** A rectangle in client coordinates of some document. */
export type SurfaceRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Where the canvas renders: its document and window, and the mapping
 * between that document's client coordinates and the host page's. Inline
 * surfaces are the host page itself; a frame surface is an iframe, maybe
 * scaled.
 */
export type PreviewSurface = {
  readonly kind: 'inline' | 'frame';
  readonly document: Document;
  readonly window: Window;
  /** Rendered size over layout size (`0.5` for a frame shown at half size). */
  readonly scale: number;
  /** A rect in the surface's client coordinates, in the host's. */
  toHost(rect: SurfaceRect): SurfaceRect;
  /** A host client point, in the surface's client coordinates. */
  fromHost(point: SurfacePoint): SurfacePoint;
  /** Every element anchoring block `id` on the surface. */
  getElementsForNode(id: string): Element[];
};

/** The surface of a canvas rendered straight into the host page. */
export function createInlineSurface(host: HTMLElement): PreviewSurface {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error('Canvas.Root: the host has no window');
  return {
    kind: 'inline',
    document: doc,
    window: view,
    scale: 1,
    toHost: (rect) => rect,
    fromHost: (point) => point,
    getElementsForNode: (id) => blockElements(host, id),
  };
}

/**
 * The surface of a canvas inside `frame`: client coordinates map through
 * the iframe's position and its scale (`transform: scale()` on the frame).
 */
export function createFrameSurface(
  frame: HTMLIFrameElement,
  host: HTMLElement,
): PreviewSurface {
  const doc = host.ownerDocument;
  const view = doc.defaultView;
  if (!view) throw new Error('Canvas.Root: the frame has no window');
  const scaleOf = (): number => {
    const width = view.innerWidth;
    const rendered = frame.getBoundingClientRect().width;
    return width > 0 && rendered > 0 ? rendered / width : 1;
  };
  return {
    kind: 'frame',
    document: doc,
    window: view,
    get scale() {
      return scaleOf();
    },
    toHost(rect) {
      const frameRect = frame.getBoundingClientRect();
      const scale = scaleOf();
      return {
        x: frameRect.left + rect.x * scale,
        y: frameRect.top + rect.y * scale,
        width: rect.width * scale,
        height: rect.height * scale,
      };
    },
    fromHost(point) {
      const frameRect = frame.getBoundingClientRect();
      const scale = scaleOf();
      return {
        x: (point.x - frameRect.left) / scale,
        y: (point.y - frameRect.top) / scale,
      };
    },
    getElementsForNode: (id) => blockElements(host, id),
  };
}
