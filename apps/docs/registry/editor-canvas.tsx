'use client';

import { useBlockActions, useSelection } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  GripVerticalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const ringMotion =
  'motion-safe:transition-[opacity] motion-safe:duration-150 motion-safe:ease-out motion-reduce:transition-none';

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
  children,
  ...props
}: React.ComponentProps<typeof Canvas.SelectionRing>) {
  return (
    <Canvas.SelectionRing
      data-slot="editor-selection-ring"
      className={cn('border-editor-selection border', ringMotion, className)}
      {...props}
      render={(ringProps, state) => (
        <div {...ringProps}>
          {state.blockType ? (
            <span
              data-slot="editor-selection-chip"
              className="bg-editor-selection text-primary-foreground pointer-events-none absolute top-1.5 left-1.5 rounded-md px-1.5 py-0.5 text-[10px] leading-none font-medium"
            >
              {state.blockType}
            </span>
          ) : null}
          {children}
        </div>
      )}
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
      className={cn('border-editor-hover border', ringMotion, className)}
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
      className={cn('border-editor-focus border', ringMotion, className)}
      {...props}
    />
  );
}

function CanvasIconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={disabled}
            onClick={onClick}
            className="pointer-events-auto"
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function DefaultBlockToolbarActions() {
  const selected = useSelection().selected;
  const actions = useBlockActions(selected ?? '');
  if (!selected || actions.parentId === null) return null;

  return (
    <>
      <DragHandle blockId={selected} />
      <Separator orientation="vertical" className="h-4" />
      <CanvasIconButton
        label="Move up"
        disabled={!actions.canMoveUp}
        onClick={() => actions.moveUp()}
      >
        <ArrowUpIcon />
      </CanvasIconButton>
      <CanvasIconButton
        label="Move down"
        disabled={!actions.canMoveDown}
        onClick={() => actions.moveDown()}
      >
        <ArrowDownIcon />
      </CanvasIconButton>
      <Separator orientation="vertical" className="h-4" />
      <CanvasIconButton label="Duplicate" onClick={() => actions.duplicate()}>
        <CopyIcon />
      </CanvasIconButton>
      <CanvasIconButton label="Delete" onClick={() => actions.remove()}>
        <Trash2Icon />
      </CanvasIconButton>
    </>
  );
}

function BlockToolbar({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Canvas.BlockToolbar>) {
  return (
    <Canvas.BlockToolbar
      data-slot="editor-block-toolbar"
      className={cn(
        'bg-background border-border flex items-center gap-0.5 rounded-md border p-0.5 shadow-sm',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-reduce:animate-none',
        className,
      )}
      {...props}
    >
      {children ?? <DefaultBlockToolbarActions />}
    </Canvas.BlockToolbar>
  );
}

function InsertButton({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Canvas.InsertButton>) {
  return (
    <Canvas.InsertButton
      data-slot="editor-insert-button"
      className={cn(
        'bg-background border-border pointer-events-auto flex size-6 items-center justify-center rounded-full border shadow-sm',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <PlusIcon className="size-3" />
          <span className="sr-only">Insert block</span>
        </>
      )}
    </Canvas.InsertButton>
  );
}

function DropIndicator({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.DropIndicator>) {
  return (
    <Canvas.DropIndicator
      data-slot="editor-drop-indicator"
      className={cn(
        'data-[variant=line]:bg-editor-drop data-[variant=line]:h-0.5 data-[variant=line]:rounded-full',
        'data-[variant=box]:border-editor-drop data-[variant=box]:bg-editor-drop/10 data-[variant=box]:rounded-md data-[variant=box]:border-2',
        'motion-safe:data-[variant=line]:animate-in motion-safe:data-[variant=line]:fade-in-0 motion-safe:data-[variant=line]:zoom-in-95 motion-safe:data-[variant=line]:duration-150 motion-reduce:animate-none',
        className,
      )}
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
  children,
  ...props
}: React.ComponentProps<typeof Canvas.DragHandle>) {
  return (
    <Canvas.DragHandle
      data-slot="editor-drag-handle"
      className={cn(
        'bg-background border-border pointer-events-auto cursor-grab rounded border p-1 select-none active:cursor-grabbing',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <GripVerticalIcon className="size-3.5" />
          <span className="sr-only">Drag to move</span>
        </>
      )}
    </Canvas.DragHandle>
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
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm disabled:opacity-50',
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
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150 motion-reduce:animate-none',
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
