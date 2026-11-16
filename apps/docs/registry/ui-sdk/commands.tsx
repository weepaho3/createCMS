// @registry ui-sdk-editor@0.3.2
'use client';

// One searchable command list for the whole editor: every registered command
// on the first page, and a page of block types to insert. Mod+K opens it on
// the first page, `/` and the add buttons on the block page. The phone's add
// sheet shows the block page on its own.

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
  CommandList,
  CommandPage,
} from '@ui-sdk/react/command';
import {
  Dialog,
  DialogBackdrop,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { ChevronRightIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { blockIcon, useChrome } from './chrome';

const ADD = 'add';

/** Inserts a block where the selection says, and selects it. */
function useInsert() {
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

/** The block types, grouped by category, as commands `block:<type>`. */
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
            keywords={[item.type, group.category ?? '']}
            disabled={!canInsert(item.type)}
            className="ed-item"
          >
            {item.previewImageUrl ? (
              <img src={item.previewImageUrl} alt="" className="ed-preview" />
            ) : (
              <Icon aria-hidden />
            )}
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
      className="ed-item"
    >
      {label}
      {command.shortcutLabel ? (
        <kbd className="ed-kbd ed-item-end">{command.shortcutLabel}</kbd>
      ) : null}
    </CommandItem>
  );
}

function useRun(after: () => void) {
  const store = useEditorStore();
  const { insert } = useInsert();
  return (value: string) => {
    after();
    // After the list closed: a command may open a dialog of its own.
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

/** The palette dialog. Mount it once inside the shell. */
export function CommandPalette() {
  const { palette, openPalette, closePalette } = useChrome();
  const ids = useCommands()
    .map((command) => command.id)
    .filter((id) => id !== 'ui.commandPalette' && id !== 'ui.quickInsert');
  const run = useRun(closePalette);
  const pages = palette === 'add' ? [ADD] : [];
  return (
    <Dialog
      open={palette !== null}
      onOpenChange={(open) => {
        if (!open) closePalette();
      }}
    >
      <DialogBackdrop className="ed-backdrop" />
      <DialogContent className="ed-dialog" data-kind="palette">
        <DialogTitle className="ed-sr">
          {palette === 'add' ? 'Add block' : 'Commands'}
        </DialogTitle>
        <Command
          autoHighlight
          loop
          pages={pages}
          onPagesChange={(next) =>
            openPalette(next.includes(ADD) ? 'add' : 'commands')
          }
          onAction={(value) => run(value)}
          className="ed-command"
        >
          {input(palette === 'add' ? 'Search blocks' : 'Search commands')}
          <CommandEmpty className="ed-empty">Nothing found.</CommandEmpty>
          <CommandList className="ed-command-list">
            <CommandPage>
              <CommandGroup className="ed-group">
                <CommandItem value="page:add" page={ADD} className="ed-item">
                  <PlusIcon aria-hidden />
                  Add block…
                  <ChevronRightIcon aria-hidden className="ed-item-end" />
                </CommandItem>
              </CommandGroup>
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

/** The block types alone, searchable: the phone's add sheet. */
export function BlockPicker({ onDone }: { onDone: () => void }) {
  const run = useRun(onDone);
  return (
    <Command
      autoHighlight
      loop
      onAction={(value) => run(value)}
      className="ed-command"
    >
      {input('Search blocks')}
      <CommandEmpty className="ed-empty">Nothing found.</CommandEmpty>
      <CommandList className="ed-command-list" data-fill="">
        <BlockCommands />
      </CommandList>
    </Command>
  );
}
