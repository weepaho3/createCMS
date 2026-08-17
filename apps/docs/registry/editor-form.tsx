'use client';

// Wraps Editor.Field parts. Does not wrap Root. Cms controls need
// CmsSourcesProvider from editor-form-cms.

import { Editor } from '@createcms/react/editor';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Field({
  className,
  ...props
}: React.ComponentProps<typeof Editor.Field>) {
  return (
    <Editor.Field
      data-slot="editor-field"
      className={cn('flex flex-col gap-1.5', className)}
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
        'text-sm font-medium data-required:after:ml-0.5 data-required:after:content-["*"]',
        className,
      )}
      {...props}
    />
  );
}

function FieldControl(props: React.ComponentProps<typeof Editor.FieldControl>) {
  return (
    <div
      data-slot="editor-field-control"
      className={cn(
        'w-full',
        '[&_input]:rounded-md [&_input]:border [&_input]:border-input',
        '[&_input]:bg-background [&_input]:px-3 [&_input]:py-2 [&_input]:text-sm',
        '[&_input]:outline-none [&_input]:focus-visible:ring-2',
        '[&_input]:focus-visible:ring-editor-ring',
      )}
    >
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
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  );
}

export { Field, FieldControl, FieldDescription, FieldError, FieldLabel, Form };
export { CmsSourcesProvider, cmsFields } from './editor-form-cms';
