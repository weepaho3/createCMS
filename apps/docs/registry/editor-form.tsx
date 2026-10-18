// @registry editor-form@0.3.2
'use client';

// The styled form of one block and the form-only edit surface. Does not wrap
// Editor.Root. Field controls for createCMS data (assets, references, links,
// variables) come from editor-form-createcms.

import type * as React from 'react';

import {
  Editor,
  useAnyBlock,
  useEditor,
  useNodeStatus,
  usePalette,
  useSelection,
} from '@createcms/react/editor';

import { cn } from '@/lib/utils';

function Form({
  className,
  ...props
}: React.ComponentProps<typeof Editor.Form>) {
  return (
    <>
      <NodeStatusNote blockId={props.blockId} />
      <Editor.Form
        data-slot="editor-form"
        className={cn(
          'flex flex-col gap-4',
          '[&>div]:flex [&>div]:flex-col [&>div]:gap-1.5',
          '[&>div[data-kind=boolean]]:grid [&>div[data-kind=boolean]]:grid-cols-[auto_1fr] [&>div[data-kind=boolean]]:items-center [&>div[data-kind=boolean]]:gap-x-2 [&>div[data-kind=boolean]]:gap-y-1',
          '[&>div[data-kind=boolean]>label]:col-start-2 [&>div[data-kind=boolean]>label]:row-start-1',
          '[&>div[data-kind=boolean]>[data-slot=checkbox]]:col-start-1 [&>div[data-kind=boolean]>[data-slot=checkbox]]:row-start-1',
          '[&>div[data-kind=boolean]>:not(label):not([data-slot=checkbox])]:col-start-2',
          '[&_fieldset]:flex [&_fieldset]:flex-col [&_fieldset]:gap-4',
          '[&_fieldset>div]:flex [&_fieldset>div]:flex-col [&_fieldset>div]:gap-1.5',
          '[&_legend]:text-sm [&_legend]:font-medium',
          className,
        )}
        {...props}
      />
    </>
  );
}

/** The block's `resolveData` state, shown above its form. */
function NodeStatusNote({ blockId }: { blockId: string }) {
  const { loading, error } = useNodeStatus(blockId);
  if (error) {
    return (
      <p
        role="alert"
        data-slot="editor-node-error"
        className="text-destructive text-sm"
      >
        {error.message}
      </p>
    );
  }
  if (loading) {
    return (
      <p
        aria-live="polite"
        data-slot="editor-node-loading"
        className="text-muted-foreground text-sm"
      >
        Loading...
      </p>
    );
  }
  return null;
}

function FormSurface({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const blockId = selected ?? rootId;
  const block = useAnyBlock(blockId);
  const palette = usePalette();
  const label =
    blockId === rootId
      ? 'Page'
      : (palette.find((item) => item.type === block?.type)?.label ??
        block?.type ??
        'Block');

  return (
    <div
      data-slot="editor-form-surface"
      className={cn(
        'mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto px-6 py-8',
        className,
      )}
      {...props}
    >
      <h1 className="mb-6 text-lg font-semibold tracking-tight">{label}</h1>
      <Form blockId={blockId} />
      {children}
    </div>
  );
}

export { Form, FormSurface };
