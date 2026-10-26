// @registry editor-canvas@0.3.2
'use client';

import {
  Editor,
  useBlockActions,
  useCommand,
  useDocSelector,
  useMoveTargets,
  usePalette,
  useSelection,
} from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const ringMotion =
  'motion-safe:transition-[opacity] motion-safe:duration-(--editor-duration) motion-safe:ease-out motion-reduce:transition-none';

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
      className={cn(ringMotion, className)}
      {...props}
    />
  );
}

function ParentRing({
  className,
  ...props
}: React.ComponentProps<typeof Canvas.ParentRing>) {
  return (
    <Canvas.ParentRing
      data-slot="editor-parent-ring"
      className={cn(ringMotion, className)}
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
      className={cn(ringMotion, className)}
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
      className={cn(
        'border-editor-focus/60 rounded-sm border border-dashed',
        className,
      )}
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
  const palette = usePalette();
  const type = useDocSelector((doc) => doc.nodes[selected ?? '']?.type);
  if (!selected || actions.parent === null) return null;
  const label = palette.find((item) => item.type === type)?.label ?? type ?? '';

  return (
    <>
      <DragHandle blockId={selected} />
      <span
        data-slot="editor-block-toolbar-label"
        className="text-muted-foreground max-w-32 truncate px-1.5 text-xs font-medium"
      >
        {label}
      </span>
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
      <MoreActions blockId={selected} />
      <Editor.Slot name="block-toolbar" props={{ blockId: selected }} />
      <Canvas.InlineRichTextToolbar>
        <Separator orientation="vertical" className="h-4" />
        <Editor.RichTextToolbar className="flex items-center gap-0.5">
          {RICH_TEXT_FORMATS.map((format) => (
            <Editor.RichTextToolbarButton
              key={format.mark}
              mark={format.mark}
              aria-label={format.label}
              title={format.label}
              className={cn(
                'hover:bg-accent aria-pressed:bg-accent pointer-events-auto inline-flex size-7 items-center justify-center rounded-sm text-xs disabled:hidden',
                format.className,
              )}
            >
              {format.text}
            </Editor.RichTextToolbarButton>
          ))}
        </Editor.RichTextToolbar>
      </Canvas.InlineRichTextToolbar>
    </>
  );
}

function CommandMenuItem({ id }: { id: string }) {
  const command = useCommand(id);
  if (!command) return null;
  return (
    <DropdownMenuItem
      className="pointer-coarse:min-h-11"
      disabled={!command.canExecute}
      onClick={() => command.run()}
    >
      {command.label ?? id}
      {command.shortcutLabel ? (
        <DropdownMenuShortcut>{command.shortcutLabel}</DropdownMenuShortcut>
      ) : null}
    </DropdownMenuItem>
  );
}

/** The structure actions that do not fit the toolbar, reachable without a drag. */
function MoreActions({ blockId }: { blockId: string }) {
  const { targets, moveTo } = useMoveTargets(blockId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="pointer-events-auto"
          />
        }
      >
        <MoreHorizontalIcon />
        <span className="sr-only">More actions</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className="pointer-coarse:min-h-11"
            disabled={targets.length === 0}
          >
            Move to…
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
            {targets.map((target) => (
              <DropdownMenuItem
                key={`${target.parent.id}:${target.parent.slot}`}
                className="pointer-coarse:min-h-11"
                style={{ paddingLeft: 8 + target.depth * 12 }}
                onClick={() => moveTo(target.parent, target.count)}
              >
                {target.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <CommandMenuItem id="block.wrap" />
        <CommandMenuItem id="clipboard.copy" />
        <CommandMenuItem id="selection.parent" />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Formats the block toolbar offers while a rich text field is edited in place. */
const RICH_TEXT_FORMATS = [
  { mark: 'bold', label: 'Bold', text: 'B', className: 'font-bold' },
  { mark: 'italic', label: 'Italic', text: 'I', className: 'italic' },
  { mark: 'underline', label: 'Underline', text: 'U', className: 'underline' },
  {
    mark: 'strike',
    label: 'Strikethrough',
    text: 'S',
    className: 'line-through',
  },
] as const;

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
        'bg-background border-border pointer-events-auto flex size-6 cursor-grab items-center justify-center rounded border select-none active:cursor-grabbing',
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
        'bg-background border-border flex flex-col gap-0.5 rounded-md border px-2 py-1 text-sm shadow-md',
        'data-[content=block]:p-1 data-[content=image]:max-w-60 data-[content=image]:gap-1 data-[content=image]:p-1.5',
        '[&_[data-editor-drag-preview-block]]:rounded-sm [&_[data-editor-drag-preview-image]]:rounded-sm [&_[data-editor-drag-preview-image]]:border',
        '[&_[data-editor-drag-preview-label]]:font-medium',
        '[&_[data-editor-drag-preview-excerpt]]:text-muted-foreground [&_[data-editor-drag-preview-excerpt]]:truncate [&_[data-editor-drag-preview-excerpt]]:text-xs',
        '[&_[data-editor-drag-preview-count]]:bg-primary [&_[data-editor-drag-preview-count]]:text-primary-foreground [&_[data-editor-drag-preview-count]]:absolute [&_[data-editor-drag-preview-count]]:top-1 [&_[data-editor-drag-preview-count]]:right-1 [&_[data-editor-drag-preview-count]]:rounded-full [&_[data-editor-drag-preview-count]]:px-1.5 [&_[data-editor-drag-preview-count]]:text-[10px]',
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
  ParentRing,
  SelectionRing,
};
