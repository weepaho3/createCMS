// @registry ui-sdk-editor@0.3.2
'use client';

import type { FramePreviewIssue } from '@createcms/react/editor';

import { Editor, useEditor, useSelection } from '@createcms/react/editor';
import * as React from 'react';

import { Form } from './form';

export type EditorEmailProps = {
  blockId?: string;
  render: React.ComponentProps<typeof Editor.FramePreview>['render'];
};

export function EditorEmail({ blockId, render }: EditorEmailProps) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const [issues, setIssues] = React.useState<readonly FramePreviewIssue[]>([]);
  const titleId = React.useId();
  const seen = new Map<string, number>();
  const keyOf = (issue: FramePreviewIssue) => {
    const base = `${issue.kind}:${'attribute' in issue ? `${issue.attribute}=${issue.value}` : ''}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return `${base}#${count}`;
  };
  return (
    <div className="ed-email">
      <div className="ed-email-form">
        <Form blockId={blockId ?? selected ?? rootId} />
      </div>
      <div className="ed-email-preview">
        <Editor.FramePreview
          selectable
          render={render}
          onIssues={setIssues}
          className="ed-frame-preview"
        />
        {issues.length > 0 ? (
          <aside aria-labelledby={titleId} className="ed-card">
            <h2 id={titleId}>Preview issues</h2>
            <ul>
              {issues.map((issue) => (
                <li key={keyOf(issue)}>
                  <strong>{issue.kind}</strong>
                  {'attribute' in issue
                    ? ` (${issue.attribute}: ${issue.value})`
                    : null}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
