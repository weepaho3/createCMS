import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { FieldRef } from './core/store';

import { composeRefs, useRender } from '../use-render';
import { describeBlock } from './announcer';
import { useSessionSelector } from './binding';
import { useEditorContext } from './context';
import { formatIssue } from './core/messages';
import { componentOf } from './core/schema';

/** One finding of a blocked save, ready to show. */
export type ErrorSummaryEntry = {
  /** Code and path: stable per finding. */
  readonly id: string;
  /** Block, field and message, from the catalog. */
  readonly label: string;
  readonly blockId: string | null;
  /** The field to focus, when the finding belongs to one. */
  readonly field: FieldRef | null;
};

/** The findings of the last blocked save, formatted from the catalog. */
export function useSaveIssues(): readonly ErrorSummaryEntry[] {
  const { store, schema, messages } = useEditorContext('useSaveIssues');
  const issues = useSessionSelector((state) => state.save.issues);
  return React.useMemo(() => {
    const { nodes } = store.getDoc();
    return issues.map((issue) => {
      const [head, key] = issue.path;
      const node = typeof head === 'string' ? nodes[head] : undefined;
      const id = `${issue.code}:${issue.path.join('.')}`;
      const message = formatIssue(issue, messages);
      if (!node) return { id, label: message, blockId: null, field: null };
      const block = describeBlock(schema, node);
      const fieldKey = typeof key === 'string' && key !== '$slots' ? key : null;
      const fieldLabel =
        fieldKey === null
          ? null
          : (componentOf(schema, node.type)?.fields[fieldKey]?.label ??
            fieldKey);
      const name = block.excerpt
        ? `${block.label} "${block.excerpt}"`
        : block.label;
      return {
        id,
        label: [name, fieldLabel, message].filter(Boolean).join(': '),
        blockId: node.id,
        field: fieldKey === null ? null : { blockId: node.id, key: fieldKey },
      };
    });
  }, [issues, store, schema, messages]);
}

type ErrorSummaryState = { count: number };

export type EditorErrorSummaryProps = UseRenderComponentProps<
  'div',
  ErrorSummaryState
>;

/**
 * The findings that blocked the last save (`beforeSave` gates), as a
 * `role="alert"` list that appears, takes focus and is announced once.
 * Each entry selects its block and moves focus into the field's control.
 * Renders nothing while there is nothing to fix.
 */
export function EditorErrorSummary(props: EditorErrorSummaryProps) {
  const { render, children, ref, ...rest } = props;
  const { store, messages } = useEditorContext('Editor.ErrorSummary');
  const entries = useSaveIssues();
  const titleId = React.useId();
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const count = entries.length;

  React.useEffect(() => {
    if (count > 0) elRef.current?.focus();
  }, [count]);

  const go = (entry: ErrorSummaryEntry) => () => {
    if (entry.blockId === null) return;
    store.select(entry.blockId);
    store.focus(entry.field);
  };

  const element = useRender<'div', ErrorSummaryState>({
    defaultTagName: 'div',
    render,
    props: {
      role: 'alert',
      'aria-labelledby': titleId,
      tabIndex: -1,
      ...rest,
      ref: composeRefs(elRef, ref),
      children: (
        <>
          <h2 id={titleId}>{messages.parts.errorSummaryTitle({ count })}</h2>
          {children ?? (
            <ul>
              {entries.map((entry) => (
                <li key={entry.id}>
                  {entry.blockId === null ? (
                    entry.label
                  ) : (
                    <button type="button" onClick={go(entry)}>
                      {entry.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ),
    },
    state: { count },
  });
  return count > 0 ? element : null;
}
