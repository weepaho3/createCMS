import type { BlockTreeNode } from '@createcms/schema';

import * as React from 'react';

import type { FramePreviewAnchor } from './frame-anchor';
import type { FramePreviewIssue } from './frame-issues';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { scrollElementIntoView } from '../scroll';
import { PREVIEW_DEBOUNCE_MS } from './components';
import { frameClickAnchor } from './frame-anchor';
import { collectFrameIssues } from './frame-issues';
import { frameSandboxAttribute } from './frame-sandbox';

export type { FramePreviewAnchor } from './frame-anchor';
export type { FramePreviewIssue } from './frame-issues';

export type FramePreviewKind = 'html' | 'blob';

export type EditorFramePreviewProps = Omit<
  React.ComponentPropsWithRef<'div'>,
  'children' | 'title'
> & {
  render: (
    tree: BlockTreeNode,
    ctx: { signal: AbortSignal },
  ) => Promise<string | Blob>;
  debounceMs?: number;
  selectable?: boolean;
  resolveAnchor?: (el: Element) => FramePreviewAnchor | null;
  onIssues?: (issues: readonly FramePreviewIssue[]) => void;
  onError?: (error: unknown) => void;
  sandbox?: string;
  title?: string;
};

type FramePreviewState = {
  loading: boolean;
  stale: boolean;
  error: boolean;
  kind?: FramePreviewKind;
};

type FrameSlot = {
  key: number;
  kind: FramePreviewKind | null;
  srcDoc?: string;
  src?: string;
};

type PendingLoad = {
  seq: number;
  index: 0 | 1;
  version: number;
};

function frameStyle(hidden: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    border: 0,
    visibility: hidden ? 'hidden' : 'visible',
  };
}

function revokeSlot(slot: FrameSlot): void {
  if (slot.src && slot.src.startsWith('blob:')) {
    URL.revokeObjectURL(slot.src);
  }
}

export function EditorFramePreview({
  render: renderTree,
  debounceMs,
  selectable = false,
  resolveAnchor,
  onIssues,
  onError,
  sandbox,
  title = 'Preview',
  style,
  ...rest
}: EditorFramePreviewProps) {
  const ctx = useEditorContext('Editor.FramePreview');
  const version = useEditorSelector((s) => s.version);
  const highlightId = useEditorSelector((s) => {
    const local = s.selection[ctx.userId];
    return local?.focus?.blockId ?? local?.selected ?? null;
  });
  const delay = Math.max(0, debounceMs ?? PREVIEW_DEBOUNCE_MS);
  const sandboxAttr = frameSandboxAttribute(selectable, sandbox);

  const [front, setFront] = React.useState<0 | 1>(0);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);
  const [kind, setKind] = React.useState<FramePreviewKind | undefined>(
    undefined,
  );
  const [displayedVersion, setDisplayedVersion] = React.useState<number | null>(
    null,
  );
  const [slots, setSlots] = React.useState<[FrameSlot, FrameSlot]>([
    { key: 0, kind: null },
    { key: 1, kind: null },
  ]);
  const stale = displayedVersion !== version;

  const renderRef = React.useRef(renderTree);
  const onIssuesRef = React.useRef(onIssues);
  const onErrorRef = React.useRef(onError);
  const resolveAnchorRef = React.useRef(resolveAnchor);
  const selectableRef = React.useRef(selectable);
  const storeRef = React.useRef(ctx.store);
  const frontRef = React.useRef<0 | 1>(0);
  const seqRef = React.useRef(0);
  const abortRef = React.useRef<AbortController | null>(null);
  const pendingRef = React.useRef<PendingLoad | null>(null);
  const slotsRef = React.useRef(slots);
  const iframeRefs = React.useRef<
    [HTMLIFrameElement | null, HTMLIFrameElement | null]
  >([null, null]);
  const unbindClicksRef = React.useRef<(() => void) | null>(null);

  React.useLayoutEffect(() => {
    renderRef.current = renderTree;
    onIssuesRef.current = onIssues;
    onErrorRef.current = onError;
    resolveAnchorRef.current = resolveAnchor;
    selectableRef.current = selectable;
    storeRef.current = ctx.store;
    slotsRef.current = slots;
  });

  const bindClicks = React.useCallback((iframe: HTMLIFrameElement | null) => {
    unbindClicksRef.current?.();
    unbindClicksRef.current = null;
    if (!selectableRef.current) return;
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const onClick = (event: Event) => {
      event.preventDefault();
      const anchor = frameClickAnchor(event.target, resolveAnchorRef.current);
      if (!anchor) return;
      storeRef.current.select(anchor.blockId);
      storeRef.current.focus(
        anchor.key ? { blockId: anchor.blockId, key: anchor.key } : null,
      );
    };
    doc.addEventListener('click', onClick, true);
    unbindClicksRef.current = () => {
      doc.removeEventListener('click', onClick, true);
    };
  }, []);

  const finishLoad = React.useCallback(
    (index: 0 | 1) => {
      const pending = pendingRef.current;
      if (!pending) return;
      if (pending.index !== index) return;
      if (pending.seq !== seqRef.current) return;

      const prev = frontRef.current;
      const prevIframe = iframeRefs.current[prev];
      const nextIframe = iframeRefs.current[index];
      try {
        const from = prevIframe?.contentWindow;
        const to = nextIframe?.contentWindow;
        if (from && to) to.scrollTo(from.scrollX, from.scrollY);
      } catch {
        // unreadable frame document
      }

      const prevSlot = slotsRef.current[prev];
      if (prev !== index) revokeSlot(prevSlot);

      frontRef.current = index;
      pendingRef.current = null;
      setFront(index);
      setLoading(false);
      setError(false);
      setKind(slotsRef.current[index].kind ?? undefined);
      setDisplayedVersion(pending.version);
      bindClicks(nextIframe);
    },
    [bindClicks],
  );

  React.useEffect(() => {
    let frame = 0;
    const timer = window.setTimeout(() => {
      frame = window.requestAnimationFrame(() => {
        void (async () => {
          seqRef.current += 1;
          const seq = seqRef.current;
          abortRef.current?.abort();
          const ac = new AbortController();
          abortRef.current = ac;
          setLoading(true);
          setError(false);

          let result: string | Blob;
          try {
            result = await renderRef.current(storeRef.current.getTree(), {
              signal: ac.signal,
            });
          } catch (caught) {
            if (ac.signal.aborted || seq !== seqRef.current) return;
            setError(true);
            setLoading(false);
            onErrorRef.current?.(caught);
            return;
          }
          if (ac.signal.aborted || seq !== seqRef.current) return;

          const back = (1 - frontRef.current) as 0 | 1;
          pendingRef.current = { seq, index: back, version };

          if (typeof result === 'string') {
            onIssuesRef.current?.(
              collectFrameIssues(
                new DOMParser().parseFromString(result, 'text/html'),
              ),
            );
            setSlots((prev) => {
              const next: [FrameSlot, FrameSlot] = [prev[0], prev[1]];
              revokeSlot(next[back]);
              next[back] = {
                key: next[back].key + 2,
                kind: 'html',
                srcDoc: result,
              };
              slotsRef.current = next;
              return next;
            });
          } else {
            const url = URL.createObjectURL(result);
            setSlots((prev) => {
              const next: [FrameSlot, FrameSlot] = [prev[0], prev[1]];
              revokeSlot(next[back]);
              next[back] = {
                key: next[back].key + 2,
                kind: 'blob',
                src: url,
              };
              slotsRef.current = next;
              return next;
            });
          }
        })();
      });
    }, delay);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [version, delay]);

  React.useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (slots[pending.index].kind !== 'blob') return;
    // Blob navigations under an empty sandbox do not always emit load.
    finishLoad(pending.index);
  }, [slots, finishLoad]);

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      unbindClicksRef.current?.();
      for (const slot of slotsRef.current) revokeSlot(slot);
    };
  }, []);

  React.useEffect(() => {
    if (!selectable || kind !== 'html') return;
    bindClicks(iframeRefs.current[front]);
    return () => {
      unbindClicksRef.current?.();
      unbindClicksRef.current = null;
    };
  }, [selectable, front, kind, displayedVersion, bindClicks]);

  React.useEffect(() => {
    if (kind !== 'html') return;
    const iframe = iframeRefs.current[front];
    const doc = iframe?.contentDocument;
    if (!doc) return;
    for (const node of doc.querySelectorAll('[data-editor-focused]')) {
      node.removeAttribute('data-editor-focused');
    }
    if (!highlightId) return;
    const node = doc.querySelector(
      '[data-editor-block="' + CSS.escape(highlightId) + '"]',
    );
    if (!node) return;
    node.setAttribute('data-editor-focused', '');
    scrollElementIntoView(node);
  }, [highlightId, front, kind, displayedVersion]);

  const frames = ([0, 1] as const).map((index) => {
    const hidden = index !== front;
    const slot = slots[index];
    return (
      <iframe
        key={slot.key}
        ref={(el) => {
          if (el) iframeRefs.current[index] = el;
        }}
        title={title}
        sandbox={sandboxAttr}
        srcDoc={slot.srcDoc}
        src={slot.src}
        inert={hidden || undefined}
        style={frameStyle(hidden)}
        onLoad={(event) => {
          iframeRefs.current[index] = event.currentTarget;
          finishLoad(index);
        }}
        onError={() => {
          finishLoad(index);
        }}
      />
    );
  });

  return useRender<'div', FramePreviewState>({
    defaultTagName: 'div',
    props: {
      ...rest,
      style: {
        // Two frames stack; the back one loads hidden so a swap does
        // not flash.
        ...style,
        position: 'relative',
      },
      children: frames,
    },
    state: { loading, stale, error, kind },
  });
}
