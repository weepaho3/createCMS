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
      className={cn('flex flex-col gap-4', className)}
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
        '[&>div]:flex [&>div]:flex-col [&>div]:gap-4',
        '[&_fieldset]:flex [&_fieldset]:flex-col [&_fieldset]:gap-4',
        '[&_fieldset>div]:flex [&_fieldset>div]:flex-col [&_fieldset>div]:gap-4',
        '[&_legend]:text-sm [&_legend]:font-medium',
        className,
      )}
      {...props}
    />
  );
}

function FormSurface({ className, ...props }: React.ComponentProps<'div'>) {
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
      className={cn('mx-auto w-full max-w-xl py-6', className)}
      {...props}
    >
      <h2 className="mb-6 text-sm font-medium">{label}</h2>
      <Form blockId={blockId} />
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
