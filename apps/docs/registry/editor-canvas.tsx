'use client';

import { Canvas } from '@createcms/react/editor/canvas';
import * as React from 'react';

import { cn } from '@/lib/utils';

function Overlay({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.Overlay>) {
  return (
    <Canvas.Overlay
      data-slot="editor-overlay"
      className={cn(className)}
      {...props}
    />
  );
}

function SelectionRing({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.SelectionRing>) {
  return (
    <Canvas.SelectionRing
      data-slot="editor-selection-ring"
      className={cn('border-2 border-editor-selection', className)}
      {...props}
    />
  );
}

function HoverRing({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.HoverRing>) {
  return (
    <Canvas.HoverRing
      data-slot="editor-hover-ring"
      className={cn('border border-editor-hover', className)}
      {...props}
    />
  );
}

function FieldRing({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.FieldRing>) {
  return (
    <Canvas.FieldRing
      data-slot="editor-field-ring"
      className={cn('border border-editor-focus', className)}
      {...props}
    />
  );
}

function BlockToolbar({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.BlockToolbar>) {
  return (
    <Canvas.BlockToolbar
      data-slot="editor-block-toolbar"
      className={cn(
        'bg-background border-border flex items-center gap-1 rounded-md border p-1 shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

function InsertButton({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.InsertButton>) {
  return (
    <Canvas.InsertButton
      data-slot="editor-insert-button"
      className={cn(
        'bg-background border-border rounded-md border px-2 py-1 text-xs shadow-sm',
        className,
      )}
      {...props}
    />
  );
}

function DropIndicator({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.DropIndicator>) {
  return (
    <Canvas.DropIndicator
      data-slot="editor-drop-indicator"
      className={cn('bg-editor-drop h-0.5', className)}
      {...props}
    />
  );
}

function InlineText({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.InlineText>) {
  return (
    <Canvas.InlineText
      data-slot="editor-inline-text"
      className={cn(className)}
      {...props}
    />
  );
}

function DragHandle({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.DragHandle>) {
  return (
    <Canvas.DragHandle
      data-slot="editor-drag-handle"
      className={cn(
        'bg-background border-border cursor-grab rounded border p-1',
        className,
      )}
      {...props}
    />
  );
}

function PaletteItem({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.PaletteItem>) {
  return (
    <Canvas.PaletteItem
      data-slot="editor-palette-item"
      className={cn(
        'bg-background border-border w-full rounded-md border px-2 py-1.5 text-left text-sm',
        className,
      )}
      {...props}
    />
  );
}

function DragPreview({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.DragPreview>) {
  return (
    <Canvas.DragPreview
      data-slot="editor-drag-preview"
      className={cn(
        'bg-background border-border rounded-md border px-2 py-1 text-sm shadow-md',
        className,
      )}
      {...props}
    />
  );
}

export {
  BlockToolbar,
  DragHandle,
  DragPreview,
  DropIndicator,
  FieldRing,
  HoverRing,
  InlineText,
  InsertButton,
  Overlay,
  PaletteItem,
  SelectionRing,
};
