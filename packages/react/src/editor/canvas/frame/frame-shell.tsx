import * as React from 'react';

import type { FrameConnection } from './frame-host';

import { composeRefs } from '../../../use-render';
import { useEditorContext } from '../../context';
import { warnOnce } from '../../core/codes';
import { bindEditorClipboard, bindEditorKeyboard } from '../../keyboard';
import { FrameHost } from './frame-host';
import { mirrorHostStyles } from './styles';
import { fitScale, MAX_AUTO_HEIGHT, trackContentHeight } from './viewport';

/** How `Canvas.Root` with `surface="frame"` builds and sizes its frame. */
export type CanvasFrameOptions = {
  /** Markup for the frame head (stylesheets, fonts); changes patch the head without a reload. */
  head?: string;
  bodyAttributes?: Readonly<Record<string, string>>;
  /** Layout width of the frame in CSS pixels; `full` (default) takes the available width. */
  width?: number | 'full';
  /** `auto` (default) follows the content; a number scrolls inside the frame. */
  height?: number | 'auto';
  /** `fit` (default) shrinks a wide frame into the available width; a number zooms. */
  scale?: number | 'fit';
  /** `mirror` (default) copies the host page's stylesheets into the frame. */
  styles?: 'mirror' | 'none';
  /** How long the canvas shows `data-loading` while mirrored sheets load. Default 5000 ms. */
  stylesTimeout?: number;
  /** Cap for `height: 'auto'`. Default `MAX_AUTO_HEIGHT` (20000). */
  maxAutoHeight?: number;
  /**
   * A sandbox for the live frame. Off by default: WebKit runs no listeners
   * and no animation frames in a frame sandboxed without `allow-scripts`.
   */
  sandbox?: string;
  /** The frame's accessible name. */
  title?: string;
};

export type CanvasFrameWrapper = React.ComponentType<{
  children: React.ReactNode;
}>;

const STYLES_TIMEOUT_MS = 5000;
const INERT_MS = 1000;
const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

type FrameShellProps = {
  options: CanvasFrameOptions;
  wrapper: CanvasFrameWrapper | undefined;
  /** Props of the outer element in the host page. */
  outer: React.ComponentPropsWithRef<'div'>;
  /** The canvas element rendered inside the frame. */
  hostNode: HTMLElement | null;
  onFrame: (frame: HTMLIFrameElement | null) => void;
  onHostLayer: (layer: HTMLElement | null) => void;
  onLoading: (loading: boolean) => void;
  children: React.ReactNode;
};

/**
 * The frame surface around the canvas: the iframe sized and scaled to the
 * chosen width, its height following the content, host stylesheets
 * mirrored in, editor shortcuts bound in the frame document, and the host
 * layer for chrome that must leave the frame.
 */
export function CanvasFrameShell({
  options,
  wrapper: Wrapper,
  outer,
  hostNode,
  onFrame,
  onHostLayer,
  onLoading,
  children,
}: FrameShellProps) {
  const { store, messages } = useEditorContext('Canvas.Root');
  const {
    head,
    bodyAttributes,
    width = 'full',
    height = 'auto',
    scale = 'fit',
    styles = 'mirror',
    stylesTimeout = STYLES_TIMEOUT_MS,
    maxAutoHeight = MAX_AUTO_HEIGHT,
    sandbox,
    title,
  } = options;
  const { style, ref, ...rest } = outer;
  const [outerEl, setOuterEl] = React.useState<HTMLDivElement | null>(null);
  const [available, setAvailable] = React.useState(0);
  const [contentHeight, setContentHeight] = React.useState(0);
  const [connection, setConnection] = React.useState<FrameConnection | null>(
    null,
  );
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  const layoutWidth = width === 'full' ? available : width;
  const zoom =
    scale === 'fit'
      ? width === 'full'
        ? 1
        : fitScale(available, width)
      : Math.max(0.05, scale);
  const layoutHeight = height === 'auto' ? contentHeight : height;

  // The available width decides `full` and `fit`.
  React.useLayoutEffect(() => {
    const view = outerEl?.ownerDocument.defaultView;
    if (!outerEl || !view) return;
    const measure = () => setAvailable(outerEl.clientWidth);
    measure();
    const observer = new view.ResizeObserver(measure);
    observer.observe(outerEl);
    return () => observer.disconnect();
  }, [outerEl]);

  React.useEffect(() => {
    onFrame(connection?.frame ?? null);
  }, [connection, onFrame]);

  // Auto height follows the frame content, frozen on a feedback loop.
  React.useEffect(() => {
    if (!connection || height !== 'auto') return;
    const hostView = connection.frame.ownerDocument.defaultView;
    if (!hostView) return;
    return trackContentHeight(connection.document, hostView, {
      maxHeight: maxAutoHeight,
      onHeight: setContentHeight,
      onLoop: () => {
        if (process.env.NODE_ENV !== 'production') {
          warnOnce(
            'E012',
            'Canvas.Root: the frame kept growing by the same amount, so its height is frozen. A block sized with 100vh grows with an auto-height frame; use a fixed frame height or drop the vh unit.',
          );
        }
      },
    });
  }, [connection, height, maxAutoHeight]);

  // Host stylesheets, mirrored until unmount; `data-loading` until they load.
  React.useEffect(() => {
    if (!connection || styles !== 'mirror') {
      onLoading(false);
      return;
    }
    const mirror = mirrorHostStyles(
      connection.frame.ownerDocument,
      connection.document,
    );
    let live = true;
    onLoading(true);
    const timer = setTimeout(() => {
      if (!live) return;
      if (process.env.NODE_ENV !== 'production') {
        warnOnce(
          'E013',
          `Canvas.Root: stylesheets mirrored into the frame did not load within ${stylesTimeout} ms; the canvas shows without them.`,
        );
      }
      onLoading(false);
    }, stylesTimeout);
    void mirror.ready.then(() => {
      if (!live) return;
      clearTimeout(timer);
      onLoading(false);
    });
    return () => {
      live = false;
      clearTimeout(timer);
      mirror.destroy();
    };
  }, [connection, styles, stylesTimeout, onLoading]);

  // Key and clipboard events in the frame never reach the host document.
  React.useEffect(() => {
    if (!connection) return;
    const unbindKeys = bindEditorKeyboard(store, connection.document);
    const unbindClipboard = bindEditorClipboard(store, connection.document);
    return () => {
      unbindKeys();
      unbindClipboard();
    };
  }, [connection, store]);

  // A builder input taking focus keeps it: the frame body is inert for a
  // moment, so nothing inside the frame pulls focus back.
  React.useEffect(() => {
    if (!connection) return;
    const hostDoc = connection.frame.ownerDocument;
    const body = connection.document.body;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest?.(EDITABLE)) return;
      if (outerEl?.contains(target)) return;
      body.inert = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        body.inert = false;
      }, INERT_MS);
    };
    hostDoc.addEventListener('focusin', onFocusIn);
    return () => {
      hostDoc.removeEventListener('focusin', onFocusIn);
      clearTimeout(timer);
      body.inert = false;
    };
  }, [connection, outerEl]);

  // The host layer sits where the canvas sits inside the frame.
  React.useLayoutEffect(() => {
    if (!connection || !hostNode) return;
    const view = connection.window;
    const update = () => {
      const rect = hostNode.getBoundingClientRect();
      setOffset((prev) =>
        prev.x === rect.left - hostNode.scrollLeft &&
        prev.y === rect.top - hostNode.scrollTop
          ? prev
          : {
              x: rect.left - hostNode.scrollLeft,
              y: rect.top - hostNode.scrollTop,
            },
      );
    };
    update();
    const hostView = connection.frame.ownerDocument.defaultView;
    const observer = hostView ? new hostView.ResizeObserver(update) : null;
    observer?.observe(connection.document.documentElement);
    observer?.observe(hostNode);
    view.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      view.removeEventListener('scroll', update, true);
    };
  }, [connection, hostNode]);

  // React 19 acquires html, head and body singletons rendered in the portal
  // and mutates the live frame shell.
  React.useLayoutEffect(() => {
    if (process.env.NODE_ENV === 'production' || !connection) return;
    const doc = connection.document;
    const allowed = new Set(Object.keys(bodyAttributes ?? {}));
    const bodyTouched = Array.from(doc.body.attributes).some(
      (attr) => !allowed.has(attr.name) && attr.name !== 'inert',
    );
    if (
      doc.documentElement.attributes.length > 0 ||
      bodyTouched ||
      doc.head.querySelector('title') !== null
    ) {
      warnOnce(
        'E011',
        'Canvas.Root: html, head or body rendered inside the frame took over the live frame shell (react-email Html, Head and Body do this). Pass head markup and body attributes through `frame` instead.',
      );
    }
  });

  React.useEffect(() => {
    if (process.env.NODE_ENV !== 'production' && sandbox !== undefined) {
      warnOnce(
        'E014',
        'Canvas.Root: the live frame is sandboxed. Without allow-scripts, WebKit runs none of its listeners or animation frames, so clicks and editing stop working there.',
      );
    }
  }, [sandbox]);

  const content = Wrapper ? <Wrapper>{children}</Wrapper> : children;
  const setOuter = React.useMemo(
    () => composeRefs<HTMLDivElement>(setOuterEl, ref),
    [ref],
  );

  return (
    <div
      {...rest}
      ref={setOuter}
      data-editor-frame-surface=""
      style={{ position: 'relative', ...style }}
    >
      <div
        style={{
          position: 'relative',
          width: layoutWidth * zoom,
          height: layoutHeight * zoom,
        }}
      >
        <FrameHost
          head={head}
          bodyAttributes={bodyAttributes}
          sandbox={sandbox}
          title={title ?? messages.parts.framePreview}
          onConnection={setConnection}
          style={{
            display: 'block',
            border: 0,
            width: layoutWidth,
            height: layoutHeight,
            transform: zoom === 1 ? undefined : `scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {content}
        </FrameHost>
        <div
          ref={onHostLayer}
          data-editor-host-layer=""
          style={
            {
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              overflow: 'visible',
              pointerEvents: 'none',
              transformOrigin: '0 0',
              transform: `scale(${zoom}) translate(${offset.x}px, ${offset.y}px)`,
              '--editor-scale': String(zoom),
            } as React.CSSProperties
          }
        />
      </div>
    </div>
  );
}
