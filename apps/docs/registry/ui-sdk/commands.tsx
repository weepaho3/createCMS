// @registry ui-sdk-editor@0.3.2
'use client';

import {
  insertPointFor,
  useCommand,
  useCommands,
  useEditor,
  useEditorContext,
  useEditorStore,
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
  CommandItemIcon,
  CommandList,
  CommandPage,
  CommandSeparator,
  CommandShortcut,
} from '@ui-sdk/react/command';
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { blockIcon, keysOf, useChrome } from './chrome';

const ADD = 'add';

export function useInsert() {
  const editor = useEditor();
  const { schema } = useEditorContext('useInsert');
  const nodes = useEditor((state) => state.nodes);
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  return {
    canInsert: (type: string) =>
      insertPointFor(schema, nodes, rootId, selected, type).allowed,
    insert: (type: string) => {
      const point = insertPointFor(schema, nodes, rootId, selected, type);
      if (!point.allowed) return;
      const id = editor.add(type, { parent: point.parent, index: point.index });
      if (id) editor.select(id);
    },
  };
}

function BlockCommands() {
  const groups = groupPaletteItems(usePalette());
  const { canInsert } = useInsert();
  return groups.map((group) => (
    <CommandGroup key={group.category ?? ''} className="ed-group">
      <CommandGroupLabel className="ed-group-label">
        {group.category ?? 'Blocks'}
      </CommandGroupLabel>
      {group.items.map((item) => {
        const Icon = blockIcon(item.type);
        return (
          <CommandItem
            key={item.type}
            value={`block:${item.type}`}
            label={item.label}
            keywords={[item.type, group.category].filter(
              (word): word is string => Boolean(word),
            )}
            disabled={!canInsert(item.type)}
            className="ed-item"
          >
            <CommandItemIcon>
              {item.previewImageUrl ? (
                <img src={item.previewImageUrl} alt="" className="ed-preview" />
              ) : (
                <Icon />
              )}
            </CommandItemIcon>
            {item.label}
          </CommandItem>
        );
      })}
    </CommandGroup>
  ));
}

function EditorCommand({ id }: { id: string }) {
  const command = useCommand(id);
  if (!command) return null;
  const label = command.label ?? id;
  return (
    <CommandItem
      value={`command:${id}`}
      label={label}
      keywords={[id]}
      disabled={!command.canExecute}
      data-agent-confirm={
        id === 'block.remove'
          ? 'Deletes the selected blocks and every block inside them'
          : undefined
      }
      className="ed-item"
    >
      {label}
      {command.shortcut ? (
        <CommandShortcut
          shortcut={keysOf(command.shortcut)}
          className="ed-kbd ed-item-end"
        />
      ) : null}
    </CommandItem>
  );
}

function useRun(after: () => void) {
  const store = useEditorStore();
  const { insert } = useInsert();
  return (value: string) => {
    after();
    // A command may open a dialog of its own, so it runs once the list closed.
    queueMicrotask(() => {
      if (value.startsWith('block:')) insert(value.slice(6));
      if (value.startsWith('command:')) {
        store.commands.execute(value.slice(8));
      }
    });
  };
}

const input = (label: string) => (
  <CommandInput
    aria-label={label}
    placeholder={`${label}…`}
    className="ed-command-input"
  />
);

export function CommandPalette() {
  const { palette, api } = useChrome();
  const closePalette = () => api.closePalette();
  const ids = useCommands()
    .map((command) => command.id)
    .filter((id) => id !== 'ui.commandPalette' && id !== 'ui.quickInsert');
  const run = useRun(closePalette);
  const pages = palette === 'add' ? [ADD] : [];
  return (
    <Dialog
      open={palette !== null}
      onOpenChange={(open, details) => {
        if (!open)
          api.closePalette({ reason: details.reason, event: details.event });
      }}
    >
      <DialogBackdrop className="ed-backdrop" />
      <DialogContent className="ed-dialog" data-kind="palette">
        <DialogTitle className="ed-sr">
          {palette === 'add' ? 'Insert a block' : 'Commands'}
        </DialogTitle>
        <Command
          autoHighlight
          pages={pages}
          onPagesChange={(next, details) =>
            api.openPalette(next.includes(ADD) ? 'add' : 'commands', {
              reason: details.reason,
              event: details.event,
            })
          }
          onAction={(value) => run(value)}
          className="ed-command"
        >
          {input(palette === 'add' ? 'Filter block types' : 'Filter commands')}
          <CommandEmpty className="ed-empty">Nothing found.</CommandEmpty>
          <CommandList className="ed-command-list">
            <CommandPage>
              <CommandGroup className="ed-group">
                <CommandGroupLabel className="ed-group-label">
                  Insert
                </CommandGroupLabel>
                <CommandItem value="page:add" page={ADD} className="ed-item">
                  <CommandItemIcon>
                    <PlusIcon />
                  </CommandItemIcon>
                  Insert a block…
                  <CommandItemIcon mirror className="ed-item-end">
                    <ChevronRightIcon />
                  </CommandItemIcon>
                </CommandItem>
              </CommandGroup>
              <CommandSeparator className="ed-separator" />
              <CommandGroup className="ed-group">
                <CommandGroupLabel className="ed-group-label">
                  Commands
                </CommandGroupLabel>
                {ids.map((id) => (
                  <EditorCommand key={id} id={id} />
                ))}
              </CommandGroup>
            </CommandPage>
            <CommandPage value={ADD}>
              <BlockCommands />
            </CommandPage>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export function BlockPicker({ onDone }: { onDone: () => void }) {
  const run = useRun(onDone);
  return (
    <Command
      autoHighlight
      onAction={(value) => run(value)}
      className="ed-command"
    >
      {input('Filter block types')}
      <CommandEmpty className="ed-empty">Nothing found.</CommandEmpty>
      <CommandList className="ed-command-list" data-fill="">
        <BlockCommands />
      </CommandList>
    </Command>
  );
}
