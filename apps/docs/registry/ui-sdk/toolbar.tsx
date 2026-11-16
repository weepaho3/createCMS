// @registry ui-sdk-editor@0.3.2
'use client';

// The editor's top toolbar: one tab stop, arrow keys between its items.
// Plugins add buttons through the `toolbar-start` and `toolbar-end` outlets.

import {
  Editor,
  useCommand,
  useHistory,
  useSave,
  useShortcutLabel,
} from '@createcms/react/editor';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { Input } from '@ui-sdk/react/input';
import { Toggle, ToggleGroup } from '@ui-sdk/react/toggle';
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from '@ui-sdk/react/toolbar';
import {
  CommandIcon,
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

import type { Device } from './chrome';

import { IconButton, useChrome } from './chrome';

const DEVICES: readonly [Device, string, React.ElementType][] = [
  ['desktop', 'Desktop', MonitorIcon],
  ['tablet', 'Tablet', TabletIcon],
  ['mobile', 'Mobile', SmartphoneIcon],
];

/** Asks for a commit message before saving, when the shell requires one. */
export function CommitDialog() {
  const { requireCommitMessage, commitOpen, setCommitOpen } = useChrome();
  const { save } = useSave();
  const [message, setMessage] = React.useState('');
  if (!requireCommitMessage) return null;
  return (
    <Dialog open={commitOpen} onOpenChange={(open) => setCommitOpen(open)}>
      <DialogBackdrop className="ed-backdrop" />
      <DialogContent className="ed-dialog" data-kind="form">
        <DialogTitle className="ed-dialog-title">Commit message</DialogTitle>
        <Input
          aria-label="Commit message"
          placeholder="Describe your changes"
          className="ed-input"
          value={message}
          onValueChange={(value) => setMessage(value)}
        />
        <div className="ed-actions">
          <DialogClose className="ed-button" data-variant="outline">
            Cancel
          </DialogClose>
          <DialogClose
            className="ed-button"
            data-variant="primary"
            action={async () => {
              await save({ message: message || undefined });
              setMessage('');
            }}
          >
            Save
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SaveButton() {
  const { dirty, saving, save } = useSave();
  const { requireCommitMessage, setCommitOpen } = useChrome();
  const shortcut = useShortcutLabel()('Mod+s');
  return (
    <ToolbarButton
      className="ed-button"
      data-variant="primary"
      data-dirty={dirty || undefined}
      data-pending={saving || undefined}
      disabled={!dirty || saving}
      aria-keyshortcuts="Control+S Meta+S"
      title={`Save (${shortcut})`}
      onClick={() => {
        if (requireCommitMessage) setCommitOpen(true);
        else void save();
      }}
    >
      <SaveIcon aria-hidden />
      Save
    </ToolbarButton>
  );
}

export function EditorToolbar() {
  const history = useHistory();
  const chrome = useChrome();
  const undo = useCommand('history.undo');
  const redo = useCommand('history.redo');
  const quickInsert = useCommand('ui.quickInsert');
  const commands = useCommand('ui.commandPalette');
  const { mode, layout, panels, togglePanel, device, setDevice } = chrome;
  const docked = layout !== 'phone';
  const canvas = mode === 'canvas';
  const tool = <ToolbarButton />;

  return (
    <header data-slot="editor-toolbar" className="ed-topbar">
      <Toolbar aria-label="Editor" className="ed-toolbar">
        {docked ? (
          <IconButton
            base={tool}
            label={panels.left ? 'Hide sidebar' : 'Show sidebar'}
            aria-pressed={panels.left}
            onClick={() => togglePanel('left')}
          >
            <PanelLeftIcon />
          </IconButton>
        ) : null}
        <Editor.Slot name="toolbar-start" />
        <IconButton
          base={tool}
          label={undo?.label ?? 'Undo'}
          shortcut={undo?.shortcutLabel}
          disabled={!history.canUndo}
          onClick={() => history.undo()}
        >
          <Undo2Icon />
        </IconButton>
        <IconButton
          base={tool}
          label={redo?.label ?? 'Redo'}
          shortcut={redo?.shortcutLabel}
          disabled={!history.canRedo}
          onClick={() => history.redo()}
        >
          <Redo2Icon />
        </IconButton>
        {canvas && docked ? (
          <>
            <ToolbarSeparator className="ed-separator" />
            <ToggleGroup
              aria-label="Device"
              value={[device]}
              deselectable={false}
              onValueChange={(value) => {
                const next = DEVICES.find(([id]) => id === value[0]);
                if (next) setDevice(next[0]);
              }}
              className="ed-segmented"
            >
              {DEVICES.map(([id, label, Icon]) => (
                <Toggle key={id} value={id} aria-label={label}>
                  <Icon aria-hidden />
                </Toggle>
              ))}
            </ToggleGroup>
            <ToolbarSeparator className="ed-separator" />
            <IconButton
              base={tool}
              label="Add block"
              shortcut={quickInsert?.shortcutLabel}
              onClick={() => chrome.openPalette('add')}
            >
              <PlusIcon />
            </IconButton>
          </>
        ) : null}
        <span className="ed-spacer" />
        <Editor.Slot name="toolbar-end" />
        <IconButton
          base={tool}
          label={commands?.label ?? 'Commands'}
          shortcut={commands?.shortcutLabel}
          onClick={() => chrome.openPalette('commands')}
        >
          <CommandIcon />
        </IconButton>
        {canvas && docked ? (
          <IconButton
            base={tool}
            label={
              layout === 'tablet'
                ? 'Inspector'
                : panels.right
                  ? 'Hide inspector'
                  : 'Show inspector'
            }
            aria-pressed={
              layout === 'tablet' ? chrome.sheet === 'props' : panels.right
            }
            onClick={() =>
              layout === 'tablet'
                ? chrome.setSheet(chrome.sheet === 'props' ? null : 'props')
                : togglePanel('right')
            }
          >
            <PanelRightIcon />
          </IconButton>
        ) : null}
        <SaveButton />
      </Toolbar>
    </header>
  );
}
