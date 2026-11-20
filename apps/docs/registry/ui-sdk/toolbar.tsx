// @registry ui-sdk-editor@0.3.2
'use client';

import {
  Editor,
  useCommand,
  useHistory,
  useSave,
} from '@createcms/react/editor';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { Field, FieldLabel } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import { Toggle, ToggleGroup } from '@ui-sdk/react/toggle';
import {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
} from '@ui-sdk/react/toolbar';
import {
  Tooltip,
  TooltipContent,
  TooltipShortcut,
  TooltipTrigger,
} from '@ui-sdk/react/tooltip';
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

import { Chrome, IconButton, useChrome } from './chrome';

const DEVICES: readonly [Device, string, React.ElementType][] = [
  ['desktop', 'Desktop', MonitorIcon],
  ['tablet', 'Tablet', TabletIcon],
  ['mobile', 'Mobile', SmartphoneIcon],
];

export function CommitDialog({ enabled }: { enabled: boolean }) {
  const { commitOpen, api } = useChrome();
  const { save } = useSave();
  const [message, setMessage] = React.useState('');
  if (!enabled) return null;
  return (
    <Dialog
      open={commitOpen}
      onOpenChange={(open, details) =>
        api.setCommitOpen(open, {
          reason: details.reason,
          event: details.event,
        })
      }
    >
      <DialogBackdrop className="ed-backdrop" />
      <DialogContent className="ed-dialog" data-kind="form">
        <DialogTitle className="ed-dialog-title">Save changes</DialogTitle>
        <Field className="ed-field">
          <FieldLabel className="ed-label">Commit message</FieldLabel>
          <Input
            placeholder="Describe your changes"
            className="ed-input"
            value={message}
            onValueChange={(value) => setMessage(value)}
          />
        </Field>
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
            Save with message
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SaveButton() {
  const { dirty, saving } = useSave();
  const { api } = useChrome();
  return (
    <Tooltip shortcut="mod+s">
      <TooltipTrigger
        render={<ToolbarButton />}
        className="ed-button"
        data-variant="primary"
        data-dirty={dirty || undefined}
        data-pending={saving || undefined}
        disabled={!dirty}
        onClick={(event: React.MouseEvent) => {
          void api.save(event.nativeEvent);
        }}
      >
        <SaveIcon aria-hidden />
        Save
      </TooltipTrigger>
      <TooltipContent
        sideOffset={6}
        className="ed-popup ed-tip"
        data-agent-hidden=""
      >
        Save
        <TooltipShortcut className="ed-kbd" />
      </TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar() {
  const history = useHistory();
  const { mode, layout, panels, sheet, device, api } = useChrome();
  const undo = useCommand('history.undo');
  const redo = useCommand('history.redo');
  const quickInsert = useCommand('ui.quickInsert');
  const commands = useCommand('ui.commandPalette');
  const docked = layout !== 'phone';
  const canvas = mode === 'canvas';
  const inspectorOpen = layout === 'tablet' ? sheet === 'props' : panels.right;

  return (
    <Chrome.Toolbar className="ed-topbar">
      <Toolbar aria-label="Editor" className="ed-toolbar">
        {docked ? (
          <IconButton
            inToolbar
            label="Sidebar"
            shortcut="Mod+b"
            aria-pressed={panels.left}
            onClick={(event: React.MouseEvent) =>
              api.togglePanel('left', event.nativeEvent)
            }
          >
            <PanelLeftIcon />
          </IconButton>
        ) : null}
        <Editor.Slot name="toolbar-start" />
        <IconButton
          inToolbar
          label={undo?.label ?? 'Undo'}
          shortcut={undo?.shortcut}
          disabled={!history.canUndo}
          onClick={() => history.undo()}
        >
          <Undo2Icon />
        </IconButton>
        <IconButton
          inToolbar
          label={redo?.label ?? 'Redo'}
          shortcut={redo?.shortcut}
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
              onValueChange={(value, details) => {
                const next = DEVICES.find(([id]) => id === value[0]);
                if (next)
                  api.setDevice(next[0], {
                    reason: 'item-press',
                    event: details.event,
                  });
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
              inToolbar
              label="Add block"
              shortcut={quickInsert?.shortcut}
              onClick={(event: React.MouseEvent) =>
                api.addBlock(event.nativeEvent)
              }
            >
              <PlusIcon />
            </IconButton>
          </>
        ) : null}
        <span className="ed-spacer" />
        <Editor.Slot name="toolbar-end" />
        <IconButton
          inToolbar
          label={commands?.label ?? 'Commands'}
          shortcut={commands?.shortcut}
          onClick={() => api.openPalette('commands', { reason: 'press' })}
        >
          <CommandIcon />
        </IconButton>
        {canvas && docked ? (
          <IconButton
            inToolbar
            label="Inspector"
            aria-pressed={inspectorOpen}
            onClick={(event: React.MouseEvent) =>
              api.togglePanel('right', event.nativeEvent)
            }
          >
            <PanelRightIcon />
          </IconButton>
        ) : null}
        <SaveButton />
      </Toolbar>
    </Chrome.Toolbar>
  );
}
