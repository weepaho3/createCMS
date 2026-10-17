import * as React from 'react';

import type { EditorDocument } from '../core/document';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';

export const PREVIEW_DEBOUNCE_MS = 100;

type PreviewState = { stale: boolean };

export type EditorPreviewProps = Omit<
  React.ComponentPropsWithRef<'div'>,
  'children'
> & {
  /** Receives the raw store document (`getDocument()`). Required. */
  render: (doc: EditorDocument) => React.ReactNode;
  /**
   * Delay before the displayed document updates. Default `PREVIEW_DEBOUNCE_MS`.
   * `0` still waits one animation frame.
   */
  debounceMs?: number;
};

/**
 * Preview passes the raw store document; the consumer maps it.
 */
export function EditorPreview({
  render: renderDocument,
  debounceMs,
  ...rest
}: EditorPreviewProps) {
  const ctx = useEditorContext('Editor.Preview');
  const version = useEditorSelector((s) => s.version);
  const delay = Math.max(0, debounceMs ?? PREVIEW_DEBOUNCE_MS);
  const [displayed, setDisplayed] = React.useState(() => ({
    version,
    doc: ctx.store.getDocument(),
  }));
  const stale = displayed.version !== version;

  React.useEffect(() => {
    if (!stale) return;
    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        setDisplayed({ version, doc: ctx.store.getDocument() });
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [stale, version, delay, ctx.store]);

  return useRender<'div', PreviewState>({
    defaultTagName: 'div',
    props: { ...rest, children: renderDocument(displayed.doc) },
    state: { stale },
  });
}
