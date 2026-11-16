// @registry ui-sdk-editor@0.3.2
'use client';

// A block's form beside its compiled e-mail, with the compile findings.

import type { FramePreviewIssue } from '@createcms/react/editor';

import { Editor, useEditor, useSelection } from '@createcms/react/editor';
import * as React from 'react';

import { Form } from './form';

export type EditorEmailProps = {
  /** Edit this block instead of the selection. */
  blockId?: string;
  render: React.ComponentProps<typeof Editor.FramePreview>['render'];
};

export function EditorEmail({ blockId, render }: EditorEmailProps) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const [issues, setIssues] = React.useState<readonly FramePreviewIssue[]>([]);
  return (
    <div data-slot="editor-email" className="ed-email">
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
          <aside aria-labelledby="ed-email-issues" className="ed-card">
            <h2 id="ed-email-issues">Preview issues</h2>
            <ul>
              {issues.map((issue, index) => (
                <li key={index}>
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
