'use client';

// Wraps Editor.Field parts. Does not wrap Root. Cms controls need
// CmsSourcesProvider from editor-form-cms.

import {
  Editor,
  useAnyBlock,
  useEditor,
  usePalette,
  useSelection,
} from '@createcms/react/editor';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Field({
  className,
  ...props
}: React.ComponentProps<typeof Editor.Field>) {
  return (
    <Editor.Field
      data-slot="editor-field"
      className={cn(
        'flex flex-col gap-1.5',
        'data-[kind=boolean]:grid data-[kind=boolean]:grid-cols-[auto_1fr] data-[kind=boolean]:items-center data-[kind=boolean]:gap-x-2 data-[kind=boolean]:gap-y-1',
        'data-[kind=boolean]:[&>[data-slot=editor-field-control]]:col-start-1 data-[kind=boolean]:[&>[data-slot=editor-field-control]]:row-start-1 data-[kind=boolean]:[&>[data-slot=editor-field-control]]:w-fit',
        'data-[kind=boolean]:[&>[data-slot=editor-field-label]]:col-start-2 data-[kind=boolean]:[&>[data-slot=editor-field-label]]:row-start-1',
        'data-[kind=boolean]:[&>[data-slot=editor-field-description]]:col-start-2',
        'data-[kind=boolean]:[&>[data-slot=editor-field-error]]:col-start-2',
        className,
      )}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Editor.FieldLabel>) {
  return (
    <Editor.FieldLabel
      data-slot="editor-field-label"
      className={cn(
        'text-sm leading-none font-medium data-required:after:ml-0.5 data-required:after:content-["*"]',
        className,
      )}
      {...props}
    />
  );
}

function FieldControl(props: React.ComponentProps<typeof Editor.FieldControl>) {
  return (
    <div data-slot="editor-field-control" className="w-full">
      <Editor.FieldControl {...props} />
    </div>
  );
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<typeof Editor.FieldDescription>) {
  return (
    <Editor.FieldDescription
      data-slot="editor-field-description"
      className={cn('text-sm text-editor-muted', className)}
      {...props}
    />
  );
}

function FieldError({
  className,
  ...props
}: React.ComponentProps<typeof Editor.FieldError>) {
  return (
    <Editor.FieldError
      data-slot="editor-field-error"
      className={cn('text-sm text-editor-invalid', className)}
      {...props}
    />
  );
}

function Form({
  className,
  ...props
}: React.ComponentProps<typeof Editor.Form>) {
  return (
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
  );
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

export {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Form,
  FormSurface,
};
export { CmsSourcesProvider, cmsFields } from './editor-form-cms';
