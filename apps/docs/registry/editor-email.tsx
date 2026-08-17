'use client';

import type { FramePreviewIssue } from '@createcms/react/editor';

import { Editor } from '@createcms/react/editor';
import { useEditor, useSelection } from '@createcms/react/editor';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { Form } from './editor-form';

type EditorEmailProps = {
  className?: string;
  blockId?: string;
  render: React.ComponentProps<typeof Editor.FramePreview>['render'];
};

function EditorEmail({ className, blockId, render }: EditorEmailProps) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const formBlockId = blockId ?? selected ?? rootId;
  const [issues, setIssues] = React.useState<readonly FramePreviewIssue[]>([]);

  return (
    <div
      data-slot="editor-email"
      className={cn('grid min-h-0 grid-cols-2 gap-4', className)}
    >
      <div className="flex flex-col gap-2 overflow-y-auto p-3">
        <Form blockId={formBlockId} />
        {!blockId ? (
          <p className="text-muted-foreground text-xs">
            Pass blockId to edit a fixed block instead of the selection.
          </p>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col gap-2">
        <Editor.FramePreview
          selectable
          render={render}
          onIssues={setIssues}
          className="min-h-64 flex-1"
        />
        {issues.length > 0 ? (
          <aside className="border-border max-h-48 overflow-y-auto rounded-md border p-2">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide">
              Preview issues
            </h2>
            <ul className="flex flex-col gap-1 text-xs">
              {issues.map((issue, index) => (
                <li key={index}>
                  <span className="font-medium">{issue.kind}</span>
                  {'attribute' in issue ? (
                    <span>
                      {' '}
                      ({issue.attribute}: {issue.value})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

export { EditorEmail };
export type { EditorEmailProps };
