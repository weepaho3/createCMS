'use client';

// The block palette (draggable rows), the searchable add-block list and its
// dialog. Composes shadcn Sidebar and Command.

import {
  Editor,
  insertPointFor,
  useEditor,
  useEditorContext,
  usePalette,
  useSelection,
} from '@createcms/react/editor';
import { groupPaletteItems } from '@createcms/react/editor/core';
import { GripVerticalIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

import { PaletteItem } from './editor-canvas';
import { useEditorChrome, blockTypeIcon } from './editor-chrome';

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
    <Command className={className}>
      <CommandInput placeholder="Search blocks…" />
      <CommandList className="max-h-none">
        <CommandEmpty>No blocks found.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup
            key={group.category ?? 'ungrouped'}
            heading={group.category ?? 'Blocks'}
          >
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
                  value={`${item.label} ${item.type} ${group.category ?? ''}`}
                  disabled={!point.allowed}
                  className="pointer-coarse:min-h-11"
                  onSelect={() => {
                    const id = editor.add(item.type, {
                      parent: point.parent,
                      index: point.index,
                    });
                    if (id) editor.select(id);
                    onAdded();
                  }}
                >
                  <Icon />
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
        className="[&_[cmdk-list]]:max-h-80"
      />
    </CommandDialog>
  );
}

function EditorPalette({ className, ...props }: React.ComponentProps<'div'>) {
  const palette = usePalette();
  const groups = groupPaletteItems(palette);
  const { setAddOpen } = useEditorChrome();

  return (
    <SidebarGroup data-slot="editor-palette" className={className} {...props}>
      <SidebarGroupLabel>Palette</SidebarGroupLabel>
      <SidebarGroupAction title="Add block" onClick={() => setAddOpen(true)}>
        <PlusIcon />
        <span className="sr-only">Add block</span>
      </SidebarGroupAction>
      <SidebarGroupContent>
        {groups.map((group) => (
          <div key={group.category ?? 'ungrouped'} className="mb-2">
            {group.category ? (
              <p className="text-sidebar-foreground/70 px-2 py-1 text-xs">
                {group.category}
              </p>
            ) : null}
            <SidebarMenu>
              {group.items.map((item) => {
                const Icon = blockTypeIcon(item.type);
                return (
                  <SidebarMenuItem key={item.type}>
                    <SidebarMenuButton
                      tooltip={item.label}
                      render={<PaletteItem type={item.type} />}
                    >
                      <GripVerticalIcon className="text-muted-foreground" />
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </div>
        ))}
        <Editor.Slot name="palette-footer" />
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export { AddBlockList, EditorAddBlockDialog, EditorPalette };
