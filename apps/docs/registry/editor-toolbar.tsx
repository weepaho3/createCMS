'use client';

// The top toolbar (history, device frame, add, commands, save), the command
// palette over the command registry and the commit message dialog.
// Composes shadcn Tooltip, ToggleGroup, Separator, Kbd, Button, Command,
// Dialog and Input. Plugins add buttons through the `toolbar-start` and
// `toolbar-end` outlets.

import {
  Editor,
  useHistory,
  useCommand,
  useCommands,
  useSave,
  useShortcutLabel,
} from '@createcms/react/editor';
import {
  CommandIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PanelRightIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  SmartphoneIcon,
  TabletIcon,
  Undo2Icon,
} from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { useEditorChrome, ToolbarHintButton } from './editor-chrome';

/** One command of the palette, disabled while it cannot run. */
function CommandPaletteItem({
  id,
  onRun,
}: {
  id: string;
  onRun: (run: () => void) => void;
}) {
  const command = useCommand(id);
  if (!command) return null;
  const label = command.label ?? id;
  return (
    <CommandItem
      value={`${label} ${id}`}
      disabled={!command.canExecute}
      onSelect={() => onRun(() => command.run())}
    >
      <span className="flex-1 truncate">{label}</span>
      {command.shortcutLabel ? <Kbd>{command.shortcutLabel}</Kbd> : null}
    </CommandItem>
  );
}

/** Every command of the editor (built-ins, then plugins), searchable. */
function EditorCommandPalette() {
  const { commandsOpen, setCommandsOpen } = useEditorChrome();
  const commands = useCommands();
  const ids = commands
    .map((command) => command.id)
    .filter((id) => id !== 'ui.commandPalette');

  return (
    <CommandDialog
      open={commandsOpen}
      onOpenChange={setCommandsOpen}
      title="Commands"
      description="Search and run an editor command"
    >
      <Command>
        <CommandInput placeholder="Search commands…" />
        <CommandList>
          <CommandEmpty>No commands found.</CommandEmpty>
          <CommandGroup heading="Commands">
            {ids.map((id) => (
              <CommandPaletteItem
                key={id}
                id={id}
                onRun={(run) => {
                  setCommandsOpen(false);
                  // After the dialog closed: a command may open another one.
                  queueMicrotask(run);
                }}
              />
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}

function EditorSaveDialog() {
  const { requireCommitMessage, saveOpen, setSaveOpen } = useEditorChrome();
  const { saving, save } = useSave();
  const [commitMessage, setCommitMessage] = React.useState('');

  if (!requireCommitMessage) return null;

  const confirmSave = () => {
    void save({ message: commitMessage || undefined });
    setSaveOpen(false);
    setCommitMessage('');
  };

  return (
    <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Commit message</DialogTitle>
        </DialogHeader>
        <Input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="Describe your changes"
        />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setSaveOpen(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={confirmSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditorToolbar({
  className,
  ...props
}: React.ComponentProps<'header'>) {
  const history = useHistory();
  const { dirty, saving, save } = useSave();
  const {
    device,
    setDevice,
    mode,
    layout,
    sheet,
    setSheet,
    requireCommitMessage,
    setAddOpen,
    setCommandsOpen,
    setSaveOpen,
  } = useEditorChrome();
  const undo = useCommand('history.undo');
  const redo = useCommand('history.redo');
  const quickInsert = useCommand('ui.quickInsert');
  const palette = useCommand('ui.commandPalette');
  const shortcutLabel = useShortcutLabel();

  const handleSave = () => {
    if (requireCommitMessage) {
      setSaveOpen(true);
      return;
    }
    void save();
  };

  return (
    <header
      data-slot="editor-toolbar"
      className={cn(
        'border-border flex h-12 shrink-0 items-center gap-1 border-b px-2',
        className,
      )}
      {...props}
    >
      {mode === 'form' || layout === 'phone' ? null : (
        <SidebarTrigger className="md:inline-flex" />
      )}
      <Editor.Slot name="toolbar-start" />
      <ToolbarHintButton
        label={undo?.label ?? 'Undo'}
        shortcut={undo?.shortcutLabel}
        disabled={!history.canUndo}
        onClick={() => history.undo()}
      >
        <Undo2Icon />
      </ToolbarHintButton>
      <ToolbarHintButton
        label={redo?.label ?? 'Redo'}
        shortcut={redo?.shortcutLabel}
        disabled={!history.canRedo}
        onClick={() => history.redo()}
      >
        <Redo2Icon />
      </ToolbarHintButton>
      {mode === 'canvas' && layout !== 'phone' ? (
        <>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToggleGroup
            value={[device]}
            onValueChange={(value) => {
              const next = value[0];
              if (
                next === 'desktop' ||
                next === 'tablet' ||
                next === 'mobile'
              ) {
                setDevice(next);
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem value="desktop" aria-label="Desktop">
              <MonitorIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="tablet" aria-label="Tablet">
              <TabletIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="mobile" aria-label="Mobile">
              <SmartphoneIcon />
            </ToggleGroupItem>
          </ToggleGroup>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolbarHintButton
            label="Add block"
            shortcut={quickInsert?.shortcutLabel}
            onClick={() => setAddOpen(true)}
          >
            <PlusIcon />
          </ToolbarHintButton>
        </>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <Editor.Slot name="toolbar-end" />
        <ToolbarHintButton
          label={palette?.label ?? 'Commands'}
          shortcut={palette?.shortcutLabel}
          onClick={() => setCommandsOpen(true)}
        >
          <CommandIcon />
        </ToolbarHintButton>
        {mode === 'canvas' && layout === 'tablet' ? (
          <ToolbarHintButton
            label="Inspector"
            onClick={() => setSheet(sheet === 'props' ? null : 'props')}
          >
            <PanelRightIcon />
          </ToolbarHintButton>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="sm"
                disabled={!dirty || saving}
                onClick={handleSave}
                className="relative"
              />
            }
          >
            {saving ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon />
            )}
            Save
            {dirty && !saving ? (
              <span
                aria-hidden
                className="bg-primary-foreground size-1.5 rounded-full"
              />
            ) : null}
          </TooltipTrigger>
          <TooltipContent className="flex items-center gap-1.5">
            Save
            <Kbd>{shortcutLabel('Mod+s')}</Kbd>
          </TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

export { EditorCommandPalette, EditorSaveDialog, EditorToolbar };
