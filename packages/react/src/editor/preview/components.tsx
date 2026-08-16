import type { BlockTreeNode } from '@createcms/schema';

import * as React from 'react';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';

export const PREVIEW_DEBOUNCE_MS = 100;

type PreviewState = { stale: boolean };

export type EditorPreviewProps = Omit<
  React.ComponentPropsWithRef<'div'>,
  'children'
> & {
  /** Receives the raw store tree (`getTree()`). Required. */
  render: (tree: BlockTreeNode) => React.ReactNode;
  /**
   * Delay before the displayed tree updates. Default `PREVIEW_DEBOUNCE_MS`.
   * `0` still waits one animation frame.
   */
  debounceMs?: number;
};

/**
 * Preview passes the raw store tree; the consumer maps it.
 */
export function EditorPreview({
  render: renderTree,
  debounceMs,
  ...rest
}: EditorPreviewProps) {
  const ctx = useEditorContext('Editor.Preview');
  const version = useEditorSelector((s) => s.version);
  const delay = Math.max(0, debounceMs ?? PREVIEW_DEBOUNCE_MS);
  const [displayed, setDisplayed] = React.useState(() => ({
    version,
    tree: ctx.store.getTree(),
  }));
  const stale = displayed.version !== version;

  React.useEffect(() => {
    if (!stale) return;
    let frame = 0;
    const timer = setTimeout(() => {
      frame = requestAnimationFrame(() => {
        setDisplayed({ version, tree: ctx.store.getTree() });
      });
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [stale, version, delay, ctx.store]);

  return useRender<'div', PreviewState>({
    defaultTagName: 'div',
    props: { ...rest, children: renderTree(displayed.tree) },
    state: { stale },
  });
}
