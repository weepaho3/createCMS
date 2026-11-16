// @registry ui-sdk-editor-palette@0.3.2
'use client';

// The block palette (draggable rows), the searchable add-block list and its
// dialog. Built on UI SDK Command and Dialog; the rows are the canvas
// package's PaletteItem, which owns the drag.

import {
  Editor,
  insertPointFor,
  useEditor,
  useEditorContext,
  usePalette,
  useSelection,
} from '@createcms/react/editor';
import { groupPaletteItems } from '@createcms/react/editor/core';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ui-sdk/react/command';
import { GripVerticalIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { PaletteItem } from './editor-canvas';
import { useEditorChrome, blockTypeIcon } from './editor-chrome';
import { CommandDialog, commandInputClass } from './editor-toolbar';
import { HintButton, itemClass } from './ui';

/**
 * A block's preview image from its definition (`previewImageUrl`). The
 * label sits next to it, so the image is decorative.
 */
function BlockPreviewImage({
  src,
  className,
}: {
  src: string;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      data-slot="editor-palette-preview"
      className={cn(
        'border-border pointer-events-none rounded-sm border bg-white object-contain',
        className,
      )}
    />
  );
}

/**
 * The searchable block list: inserts into the selected block when it
 * accepts the type, else right after it, else at the end of the page.
 */
function AddBlockList({
  onAdded,
  className,
}: {
  onAdded: () => void;
  className?: string;
}) {
  const editor = useEditor();
  const { schema } = useEditorContext('AddBlockList');
  const nodes = useEditor((state) => state.nodes);
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const groups = groupPaletteItems(usePalette());

  return (
    <Command autoHighlight loop className={className}>
      <CommandInput
        aria-label="Search blocks"
        placeholder="Search blocks…"
        className={commandInputClass}
      />
      <CommandEmpty className="text-muted-foreground hidden py-6 text-center text-sm data-empty:block">
        No blocks found.
      </CommandEmpty>
      <CommandList className="overflow-y-auto p-1">
        {groups.map((group) => (
          <CommandGroup key={group.category ?? 'ungrouped'}>
            <CommandGroupLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
              {group.category ?? 'Blocks'}
            </CommandGroupLabel>
            {group.items.map((item) => {
              const Icon = blockTypeIcon(item.type);
              const point = insertPointFor(
                schema,
                nodes,
                rootId,
                selected,
                item.type,
              );
              return (
                <CommandItem
                  key={item.type}
                  value={item.type}
                  label={item.label}
                  keywords={[item.type, group.category ?? '']}
                  disabled={!point.allowed}
                  className={itemClass}
                  onSelect={() => {
                    const id = editor.add(item.type, {
                      parent: point.parent,
                      index: point.index,
                    });
                    if (id) editor.select(id);
                    onAdded();
                  }}
                >
                  {item.previewImageUrl ? (
                    <BlockPreviewImage
                      src={item.previewImageUrl}
                      className="h-10 w-16 shrink-0"
                    />
                  ) : (
                    <Icon />
                  )}
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

function EditorAddBlockDialog() {
  const { addOpen, setAddOpen } = useEditorChrome();
  return (
    <CommandDialog
      open={addOpen}
      onOpenChange={setAddOpen}
      title="Add block"
      description="Search and insert a block"
    >
      <AddBlockList
        onAdded={() => setAddOpen(false)}
        className="[&_[data-slot=command-list]]:max-h-80"
      />
    </CommandDialog>
  );
}

function EditorPalette({ className, ...props }: React.ComponentProps<'div'>) {
  const palette = usePalette();
  const groups = groupPaletteItems(palette);
  const { setAddOpen } = useEditorChrome();

  return (
    <section
      data-slot="editor-palette"
      aria-labelledby="editor-palette-label"
      className={cn('flex flex-col gap-1 p-2', className)}
      {...props}
    >
      <div className="flex h-8 items-center gap-1 px-2">
        <h2
          id="editor-palette-label"
          className="text-sidebar-foreground/70 flex-1 text-xs font-medium group-data-collapsed/panel:sr-only"
        >
          Palette
        </h2>
        <HintButton
          label="Add block"
          size="icon-xs"
          onClick={() => setAddOpen(true)}
          className="group-data-collapsed/panel:hidden"
        >
          <PlusIcon />
        </HintButton>
      </div>
      {groups.map((group) => (
        <div key={group.category ?? 'ungrouped'} className="mb-2">
          {group.category ? (
            <p className="text-sidebar-foreground/70 px-2 py-1 text-xs group-data-collapsed/panel:hidden">
              {group.category}
            </p>
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = blockTypeIcon(item.type);
              const image = item.previewImageUrl;
              return (
                <li key={item.type}>
                  <PaletteItem
                    type={item.type}
                    title={item.label}
                    className={cn(
                      'outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0',
                      image && 'flex-wrap py-2',
                      'group-data-collapsed/panel:justify-center group-data-collapsed/panel:px-0',
                    )}
                  >
                    {image ? (
                      <BlockPreviewImage
                        src={image}
                        className="h-16 w-full group-data-collapsed/panel:hidden"
                      />
                    ) : null}
                    <GripVerticalIcon className="text-muted-foreground group-data-collapsed/panel:hidden" />
                    <Icon />
                    <span className="truncate group-data-collapsed/panel:sr-only">
                      {item.label}
                    </span>
                  </PaletteItem>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <Editor.Slot name="palette-footer" />
    </section>
  );
}

export { AddBlockList, EditorAddBlockDialog, EditorPalette };
