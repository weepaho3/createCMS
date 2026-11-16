// @registry ui-sdk-editor-toolbar@0.3.2
'use client';

// The top toolbar (history, device frame, add, commands, save), the command
// palette over the command registry and the commit message dialog. Built on
// UI SDK Toolbar, ToggleGroup, Tooltip, Dialog and Command. Plugins add
// buttons through the `toolbar-start` and `toolbar-end` outlets.

import {
  Editor,
  useCommand,
  useCommands,
  useHistory,
  useSave,
  useShortcutLabel,
} from '@createcms/react/editor';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@ui-sdk/react/command';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { Toggle, ToggleGroup } from '@ui-sdk/react/toggle';
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from '@ui-sdk/react/toolbar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ui-sdk/react/tooltip';
import {
  CommandIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  Redo2Icon,
  SaveIcon,
  SmartphoneIcon,
  TabletIcon,
  Undo2Icon,
} from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import type { Device } from './editor-chrome';

import { useEditorChrome } from './editor-chrome';
import {
  Button,
  Input,
  Kbd,
  backdropClass,
  buttonVariants,
  dialogClass,
  itemClass,
  popupClass,
} from './ui';

/** A toolbar button named by its tooltip, with its shortcut as a hint. */
function ToolbarHint({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ToolbarButton
            disabled={disabled}
            onClick={onClick}
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
          />
        }
      >
        {children}
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        className={cn(
          popupClass,
          'flex items-center gap-1.5 px-2 py-1 text-xs',
        )}
      >
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

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
      value={id}
      label={label}
      keywords={[id]}
      disabled={!command.canExecute}
      className={itemClass}
      onSelect={() => onRun(() => command.run())}
    >
      <span className="flex-1 truncate">{label}</span>
      {command.shortcutLabel ? <Kbd>{command.shortcutLabel}</Kbd> : null}
    </CommandItem>
  );
}

/** A searchable list in a modal dialog: the command palette and add block. */
function CommandDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogBackdrop className={backdropClass} />
      <DialogContent
        className={cn(
          dialogClass,
          'top-[20%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg',
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

const commandInputClass =
  'placeholder:text-muted-foreground h-11 w-full border-b bg-transparent px-3 text-sm outline-none';

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
      <Command autoHighlight loop>
        <CommandInput
          aria-label="Search commands"
          placeholder="Search commands…"
          className={commandInputClass}
        />
        <CommandEmpty className="text-muted-foreground hidden py-6 text-center text-sm data-empty:block">
          No commands found.
        </CommandEmpty>
        <CommandList className="max-h-80 overflow-y-auto p-1">
          <CommandGroup>
            <CommandGroupLabel className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
              Commands
            </CommandGroupLabel>
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

  return (
    <Dialog open={saveOpen} onOpenChange={(next) => setSaveOpen(next)}>
      <DialogBackdrop className={backdropClass} />
      <DialogContent className={cn(dialogClass, 'sm:max-w-sm')}>
        <DialogTitle className="text-lg font-semibold">
          Commit message
        </DialogTitle>
        <Input
          aria-label="Commit message"
          value={commitMessage}
          onValueChange={(value) => setCommitMessage(value)}
          placeholder="Describe your changes"
        />
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <DialogClose
            render={<Button disabled={saving} />}
            action={() => {
              void save({ message: commitMessage || undefined });
              setCommitMessage('');
            }}
          >
            Save
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const DEVICES: { value: Device; label: string; icon: React.ElementType }[] = [
  { value: 'desktop', label: 'Desktop', icon: MonitorIcon },
  { value: 'tablet', label: 'Tablet', icon: TabletIcon },
  { value: 'mobile', label: 'Mobile', icon: SmartphoneIcon },
];

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
    sidebarCollapsed,
    toggleSidebar,
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
        'border-border flex h-12 shrink-0 border-b px-2',
        className,
      )}
      {...props}
    >
      <Toolbar
        aria-label="Editor"
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        {mode === 'form' || layout === 'phone' ? null : (
          <ToolbarHint
            label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={toggleSidebar}
          >
            <PanelLeftIcon />
          </ToolbarHint>
        )}
        <Editor.Slot name="toolbar-start" />
        <ToolbarHint
          label={undo?.label ?? 'Undo'}
          shortcut={undo?.shortcutLabel}
          disabled={!history.canUndo}
          onClick={() => history.undo()}
        >
          <Undo2Icon />
        </ToolbarHint>
        <ToolbarHint
          label={redo?.label ?? 'Redo'}
          shortcut={redo?.shortcutLabel}
          disabled={!history.canRedo}
          onClick={() => history.redo()}
        >
          <Redo2Icon />
        </ToolbarHint>
        {mode === 'canvas' && layout !== 'phone' ? (
          <>
            <ToolbarSeparator className="bg-border mx-1 h-5 w-px" />
            <ToggleGroup
              aria-label="Device"
              value={[device]}
              deselectable={false}
              onValueChange={(value) => {
                const next = DEVICES.find((item) => item.value === value[0]);
                if (next) setDevice(next.value);
              }}
              className="border-border flex items-center overflow-hidden rounded-md border"
            >
              {DEVICES.map(({ value, label, icon: Icon }) => (
                <Toggle
                  key={value}
                  value={value}
                  aria-label={label}
                  className="hover:bg-muted data-pressed:bg-muted flex size-7 items-center justify-center outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-4"
                >
                  <Icon />
                </Toggle>
              ))}
            </ToggleGroup>
            <ToolbarSeparator className="bg-border mx-1 h-5 w-px" />
            <ToolbarHint
              label="Add block"
              shortcut={quickInsert?.shortcutLabel}
              onClick={() => setAddOpen(true)}
            >
              <PlusIcon />
            </ToolbarHint>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Editor.Slot name="toolbar-end" />
          <ToolbarHint
            label={palette?.label ?? 'Commands'}
            shortcut={palette?.shortcutLabel}
            onClick={() => setCommandsOpen(true)}
          >
            <CommandIcon />
          </ToolbarHint>
          {mode === 'canvas' && layout === 'tablet' ? (
            <ToolbarHint
              label="Inspector"
              onClick={() => setSheet(sheet === 'props' ? null : 'props')}
            >
              <PanelRightIcon />
            </ToolbarHint>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <ToolbarButton
                  disabled={!dirty || saving}
                  onClick={handleSave}
                  className={cn(buttonVariants({ size: 'sm' }), 'relative')}
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
            <TooltipContent
              sideOffset={6}
              className={cn(
                popupClass,
                'flex items-center gap-1.5 px-2 py-1 text-xs',
              )}
            >
              Save
              <Kbd>{shortcutLabel('Mod+s')}</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </Toolbar>
    </header>
  );
}

export {
  CommandDialog,
  EditorCommandPalette,
  EditorSaveDialog,
  EditorToolbar,
  commandInputClass,
};
