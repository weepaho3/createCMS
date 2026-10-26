import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { MissingRequiredField } from '../core/schema';
import type { FieldRef } from '../core/store';
import type { ErrorSummaryEntry } from '../error-summary';

import { useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import { useEditorContext } from '../context';
import { useSaveIssues } from '../error-summary';
import { useMissingRequired } from '../hooks';
import { useCanvasContext } from './context';
import { useMeasuredRect } from './rects';

/** One problem of a block, ready to show. */
export type CanvasBlockIssue = {
  /** Stable per finding. */
  readonly id: string;
  /** The field it belongs to, or `null` for the block itself. */
  readonly key: string | null;
  /** Field label and message, from the catalog. */
  readonly message: string;
};

/**
 * The problems of every block: required fields left empty (live) and the
 * findings of the last blocked save. Blocks without problems are absent.
 */
export function blockIssues(
  missing: readonly MissingRequiredField[],
  saved: readonly ErrorSummaryEntry[],
  required: string,
): ReadonlyMap<string, readonly CanvasBlockIssue[]> {
  const out = new Map<string, CanvasBlockIssue[]>();
  const add = (blockId: string, issue: CanvasBlockIssue) => {
    const list = out.get(blockId) ?? [];
    if (!list.some((entry) => entry.id === issue.id)) list.push(issue);
    out.set(blockId, list);
  };
  for (const field of missing) {
    add(field.blockId, {
      id: `required:${field.blockId}.${field.key}`,
      key: field.key,
      message: `${field.label}: ${required}`,
    });
  }
  for (const entry of saved) {
    if (entry.blockId === null) continue;
    // A blocked save reports an empty required field too; keep one entry.
    if (entry.id === `required:${entry.blockId}.${entry.field?.key}`) continue;
    add(entry.blockId, {
      id: entry.id,
      key: entry.field?.key ?? null,
      message: entry.label,
    });
  }
  return out;
}

type IssueMarkerState = {
  /** Problems of the block. */
  count: number;
  blockType: string | null;
  editorIssueMarker: boolean;
};

export type CanvasIssueMarkerProps = Omit<
  React.ComponentPropsWithRef<'button'>,
  'children'
> & {
  /** The badge content; default the number of problems. */
  children?: (issues: readonly CanvasBlockIssue[]) => React.ReactNode;
  render?: UseRenderComponentProps<'button', IssueMarkerState>['render'];
};

/**
 * Marks every block with problems: a `button` over the block's box (the
 * ring is the button's own border) that selects the block and focuses its
 * first faulty field. Its accessible name lists the problems. Hidden while
 * dragging. Put it in `Canvas.Overlay`; it sets `pointer-events: auto` only
 * on a badge child, so the block stays clickable through the ring.
 */
export function CanvasIssueMarker(props: CanvasIssueMarkerProps) {
  const canvas = useCanvasContext('Canvas.IssueMarker');
  const { messages } = useEditorContext('Canvas.IssueMarker');
  const missing = useMissingRequired();
  const saved = useSaveIssues();
  const issues = React.useMemo(
    () => blockIssues(missing, saved, messages.field.required({})),
    [missing, saved, messages],
  );
  if (canvas.dragging || issues.size === 0) return null;
  return [...issues].map(([blockId, list]) => (
    <IssueMarkerItem key={blockId} blockId={blockId} issues={list} {...props} />
  ));
}

function IssueMarkerItem({
  blockId,
  issues,
  children,
  render,
  style,
  onClick,
  ...rest
}: CanvasIssueMarkerProps & {
  blockId: string;
  issues: readonly CanvasBlockIssue[];
}) {
  const canvas = useCanvasContext('Canvas.IssueMarker');
  const { store, schema, messages } = useEditorContext('Canvas.IssueMarker');
  const rect = useMeasuredRect(canvas.measurer, 'visible', blockId);
  const node = store.getDoc().nodes[blockId] ?? null;
  const block = node ? describeBlock(schema, node).label : blockId;
  const first = issues.find((issue) => issue.key !== null)?.key ?? null;
  const focus: FieldRef | null =
    first === null ? null : { blockId, key: first };
  const element = useRender<'button', IssueMarkerState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      ...rest,
      'aria-label': messages.parts.issueMarker({
        block,
        issues: issues.map((issue) => issue.message),
      }),
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        store.select(blockId);
        store.focus(focus);
      },
      style: rect
        ? {
            position: 'absolute',
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            boxSizing: 'border-box',
            pointerEvents: 'none',
            background: 'none',
            padding: 0,
            ...style,
          }
        : style,
      children: (
        <span data-editor-issue-badge="" style={{ pointerEvents: 'auto' }}>
          {children ? children(issues) : issues.length}
        </span>
      ),
    },
    state: {
      count: issues.length,
      blockType: node?.type ?? null,
      editorIssueMarker: true,
    },
  });
  if (rect === null) return null;
  return element;
}
