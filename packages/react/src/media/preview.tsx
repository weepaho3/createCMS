import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { PreviewKind } from './core/preview';
import type { MediaStoreState } from './core/store';
import type { MediaAsset } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import {
  PREVIEW_MAX_ZOOM,
  previewKindOf,
  previewNeighbours,
  stepZoom,
  swipeOf,
  toggleZoom,
} from './core/preview';
import { assetName } from './grid';
import { useSelector } from './use-store';

export type MediaPreview = {
  /** The open asset, or `null` while the preview is closed. */
  asset: MediaAsset | null;
  kind: PreviewKind | null;
  /** 0-based position in the collection order the preview opened with. */
  index: number;
  total: number;
  zoom: number;
  pan: { x: number; y: number };
  rotation: 0 | 90 | 180 | 270;
  canPrev: boolean;
  canNext: boolean;
  open: (id: string) => void;
  close: () => void;
  step: (delta: 1 | -1) => void;
  zoomTo: (zoom: number, pan?: { x: number; y: number }) => void;
  zoomStep: (step: 'in' | 'out' | 'reset') => void;
  rotate: () => void;
};

const selectPreview = (state: MediaStoreState) => state.preview;
const selectById = (state: MediaStoreState) => state.collection.byId;

/** The preview state of the enclosing `Media.Root` with its commands. */
export function usePreview(): MediaPreview {
  const { store } = useMediaContext('usePreview');
  const preview = useSelector(store, selectPreview, Object.is);
  const byId = useSelector(store, selectById, Object.is);
  return React.useMemo(() => {
    const asset = preview.openId ? (byId[preview.openId] ?? null) : null;
    const index = preview.openId ? preview.ids.indexOf(preview.openId) : -1;
    return {
      asset,
      kind: asset ? previewKindOf(asset.mimeType) : null,
      index,
      total: preview.ids.length,
      zoom: preview.zoom,
      pan: preview.pan,
      rotation: preview.rotation,
      canPrev: index > 0,
      canNext: index >= 0 && index < preview.ids.length - 1,
      open: (id) => void store.dispatch({ type: 'openPreview', id }),
      close: () => void store.dispatch({ type: 'closePreview' }),
      step: (delta) => void store.dispatch({ type: 'previewStep', delta }),
      zoomTo: (zoom, pan) =>
        void store.dispatch({ type: 'previewZoom', zoom, pan }),
      zoomStep: (step) =>
        void store.dispatch({
          type: 'previewZoom',
          zoom: stepZoom(preview.zoom, step),
          pan: step === 'reset' ? { x: 0, y: 0 } : preview.pan,
        }),
      rotate: () => void store.dispatch({ type: 'previewRotate' }),
    };
  }, [preview, byId, store]);
}

const PreviewContext = React.createContext<MediaPreview | null>(null);

function usePreviewContext(name: string): MediaPreview {
  const value = React.useContext(PreviewContext);
  if (!value) throw new Error(`${name} must be used within Preview.Root.`);
  return value;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),video[controls],audio[controls],iframe,[tabindex]:not([tabindex="-1"])';

function isRtl(element: HTMLElement | null): boolean {
  return (
    !!element &&
    typeof getComputedStyle === 'function' &&
    getComputedStyle(element).direction === 'rtl'
  );
}

// --- Preview.Root -------------------------------------------------------------------

type PreviewRootState = { open: boolean; kind: PreviewKind | null };

export type PreviewRootProps = UseRenderComponentProps<'div', PreviewRootState>;

/**
 * A modal `div[role="dialog"]` around the open asset, rendered only while
 * the preview is open (`usePreview().open(id)`, or `Media.Grid`
 * `onAction`). It traps focus, returns it to the opener on close and maps
 * keys: Escape closes, arrows step (mirrored in RTL), `+`/`-`/`0` zoom,
 * `r` rotates. Neighbouring images are preloaded.
 */
export function PreviewRoot(props: PreviewRootProps) {
  const { render, children, ...rest } = props;
  const preview = usePreview();
  const { messages, format } = useMediaMessages();
  const { assetUrl, store } = useMediaContext('Preview.Root');
  const ref = React.useRef<HTMLDivElement | null>(null);
  const openerRef = React.useRef<Element | null>(null);
  const open = preview.asset !== null;

  React.useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    ref.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  const openId = preview.asset?.id ?? null;
  React.useEffect(() => {
    if (!openId || typeof Image === 'undefined') return;
    const state = store.getState();
    for (const id of previewNeighbours(state.preview.ids, openId)) {
      const asset = state.collection.byId[id];
      if (asset && previewKindOf(asset.mimeType) === 'image') {
        new Image().src = assetUrl(asset);
      }
    }
  }, [openId, store, assetUrl]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const typing =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable;
    const rtl = isRtl(ref.current);
    let handled = true;
    switch (event.key) {
      case 'Escape':
        preview.close();
        break;
      case 'ArrowRight':
        if (typing || preview.zoom > 1) handled = false;
        else preview.step(rtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        if (typing || preview.zoom > 1) handled = false;
        else preview.step(rtl ? 1 : -1);
        break;
      case '+':
      case '=':
        if (typing) handled = false;
        else preview.zoomStep('in');
        break;
      case '-':
        if (typing) handled = false;
        else preview.zoomStep('out');
        break;
      case '0':
        if (typing) handled = false;
        else preview.zoomStep('reset');
        break;
      case 'r':
        if (typing) handled = false;
        else preview.rotate();
        break;
      case 'Tab': {
        const nodes = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
        );
        if (nodes.length === 0) break;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          first.focus();
        } else if (document.activeElement === ref.current) {
          (event.shiftKey ? last : first).focus();
        } else {
          handled = false;
        }
        break;
      }
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const element = useRender({
    defaultTagName: 'div',
    render,
    state: { open, kind: preview.kind } satisfies PreviewRootState,
    props: mergeProps<'div'>(
      {
        ref,
        role: 'dialog',
        'aria-modal': true,
        'aria-label': preview.asset
          ? messages.preview.label({ name: assetName(preview.asset) }, format)
          : undefined,
        tabIndex: -1,
        onKeyDown,
      },
      rest,
      { children },
    ),
  });
  if (!open) return null;
  return (
    <PreviewContext.Provider value={preview}>{element}</PreviewContext.Provider>
  );
}

// --- Preview.Stage ------------------------------------------------------------------

type PreviewStageState = {
  kind: PreviewKind;
  zoomed: boolean;
  rotation: 0 | 90 | 180 | 270;
};

export type PreviewStageProps = Omit<
  UseRenderComponentProps<'div', PreviewStageState>,
  'children'
> & {
  /** Replaces the default renderer for some kinds; return `undefined` to keep it. */
  children?: (props: {
    asset: MediaAsset;
    kind: PreviewKind;
    src: string;
  }) => React.ReactNode;
};

/**
 * The open asset with a default renderer per kind: images and SVG as `img`
 * (zoom by double click, pan by drag while zoomed, swipe to step or close
 * on touch), video and audio with native controls, PDF in the browser's
 * viewer, anything else as `preview.unavailable`.
 */
export function PreviewStage(props: PreviewStageProps) {
  const { children, render, ...rest } = props;
  const preview = usePreviewContext('Preview.Stage');
  const { assetUrl } = useMediaContext('Preview.Stage');
  const { messages } = useMediaMessages();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const gesture = React.useRef<{
    x: number;
    y: number;
    at: number;
    pan: { x: number; y: number };
  } | null>(null);
  const asset = preview.asset!;
  const kind = preview.kind!;
  const src = assetUrl(asset);
  const zoomed = preview.zoom > 1;

  const custom = children?.({ asset, kind, src });
  let content: React.ReactNode = custom;
  if (custom === undefined) {
    switch (kind) {
      case 'image':
      case 'svg': {
        const natural =
          asset.width && ref.current
            ? Math.min(
                PREVIEW_MAX_ZOOM,
                Math.max(1, asset.width / ref.current.clientWidth),
              )
            : 2;
        content = (
          <img
            src={src}
            alt=""
            draggable={false}
            onDoubleClick={() =>
              preview.zoomTo(toggleZoom(preview.zoom, natural), { x: 0, y: 0 })
            }
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              transform: `translate(${preview.pan.x}px, ${preview.pan.y}px) scale(${preview.zoom}) rotate(${preview.rotation}deg)`,
              cursor: zoomed ? 'grab' : 'zoom-in',
              touchAction: 'none',
              userSelect: 'none',
            }}
          />
        );
        break;
      }
      case 'video':
        content = <video src={src} controls preload="metadata" />;
        break;
      case 'audio':
        content = <audio src={src} controls preload="metadata" />;
        break;
      case 'pdf':
        content = (
          <object
            data={src}
            type="application/pdf"
            aria-label={assetName(asset)}
            style={{ width: '100%', height: '100%' }}
          >
            <p>{messages.preview.unavailable}</p>
          </object>
        );
        break;
      case 'fallback':
        content = <p>{messages.preview.unavailable}</p>;
        break;
    }
  }

  const onPointerDown = (event: React.PointerEvent) => {
    if (kind !== 'image' && kind !== 'svg') return;
    gesture.current = {
      x: event.clientX,
      y: event.clientY,
      at: event.timeStamp,
      pan: preview.pan,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const start = gesture.current;
    if (!start || !zoomed) return;
    preview.zoomTo(preview.zoom, {
      x: start.pan.x + event.clientX - start.x,
      y: start.pan.y + event.clientY - start.y,
    });
  };
  const onPointerUp = (event: React.PointerEvent) => {
    const start = gesture.current;
    gesture.current = null;
    if (!start || event.pointerType === 'mouse') return;
    const swipe = swipeOf(
      event.clientX - start.x,
      event.clientY - start.y,
      event.timeStamp - start.at,
      { rtl: isRtl(ref.current), zoomed },
    );
    if (swipe === 'next' && preview.canNext) preview.step(1);
    else if (swipe === 'prev' && preview.canPrev) preview.step(-1);
    else if (swipe === 'close') preview.close();
  };

  return useRender({
    defaultTagName: 'div',
    render,
    state: {
      kind,
      zoomed,
      rotation: preview.rotation,
    } satisfies PreviewStageState,
    props: mergeProps<'div'>(
      {
        ref,
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onPointerCancel: () => {
          gesture.current = null;
        },
        children: content,
      },
      rest,
    ),
  });
}

// --- buttons and position -------------------------------------------------------------

type PreviewAction =
  | 'prev'
  | 'next'
  | 'close'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'rotate';

function usePreviewButton(
  action: PreviewAction,
  props: UseRenderComponentProps<'button'>,
) {
  const { render, ...rest } = props;
  const preview = usePreviewContext(`Preview.${action}`);
  const { messages } = useMediaMessages();
  const run: Record<PreviewAction, () => void> = {
    prev: () => preview.step(-1),
    next: () => preview.step(1),
    close: preview.close,
    zoomIn: () => preview.zoomStep('in'),
    zoomOut: () => preview.zoomStep('out'),
    zoomReset: () => preview.zoomStep('reset'),
    rotate: preview.rotate,
  };
  const disabled: Record<PreviewAction, boolean> = {
    prev: !preview.canPrev,
    next: !preview.canNext,
    close: false,
    zoomIn: preview.zoom >= PREVIEW_MAX_ZOOM,
    zoomOut: preview.zoom <= 1,
    zoomReset: preview.zoom === 1,
    rotate: preview.kind !== 'image' && preview.kind !== 'svg',
  };
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: disabled[action],
        'aria-label': messages.preview[action],
        onClick: run[action],
      },
      rest,
    ),
  });
}

export type PreviewButtonProps = UseRenderComponentProps<'button'>;

/** Steps to the previous asset; `disabled` at the first. */
export function PreviewPrev(props: PreviewButtonProps) {
  return usePreviewButton('prev', props);
}
/** Steps to the next asset; `disabled` at the last. */
export function PreviewNext(props: PreviewButtonProps) {
  return usePreviewButton('next', props);
}
/** Closes the preview. */
export function PreviewClose(props: PreviewButtonProps) {
  return usePreviewButton('close', props);
}
export function PreviewZoomIn(props: PreviewButtonProps) {
  return usePreviewButton('zoomIn', props);
}
export function PreviewZoomOut(props: PreviewButtonProps) {
  return usePreviewButton('zoomOut', props);
}
/** Back to fit; `disabled` while not zoomed. */
export function PreviewZoomReset(props: PreviewButtonProps) {
  return usePreviewButton('zoomReset', props);
}
/** Turns images by 90 degrees (view only). */
export function PreviewRotate(props: PreviewButtonProps) {
  return usePreviewButton('rotate', props);
}

export type PreviewPositionProps = UseRenderComponentProps<'span'>;

/** "3 of 40" for the open asset. */
export function PreviewPosition(props: PreviewPositionProps) {
  const { render, ...rest } = props;
  const preview = usePreviewContext('Preview.Position');
  const { messages, format } = useMediaMessages();
  return useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>(
      {
        children: messages.preview.position(
          { index: preview.index + 1, total: preview.total },
          format,
        ),
      },
      rest,
    ),
  });
}
