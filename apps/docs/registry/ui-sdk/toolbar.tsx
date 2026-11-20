// @registry ui-sdk-editor@0.3.2
'use client';

import {
  Editor,
  useCommand,
  useHistory,
  useSave,
} from '@createcms/react/editor';
import { Button } from '@ui-sdk/react/button';
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@ui-sdk/react/dialog';
import { Field, FieldLabel } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import { Toggle, ToggleGroup, ToggleIcon } from '@ui-sdk/react/toggle';
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

import { Chrome, IconButton, useChrome } from './chrome';

const DEVICES: readonly [Device, string, React.ElementType][] = [
  ['desktop', 'Desktop', MonitorIcon],
  ['tablet', 'Tablet', TabletIcon],
  ['mobile', 'Mobile', SmartphoneIcon],
];

export const SIDEBAR_KEYS = 'mod+b';
export const SAVE_KEYS = 'mod+s';

export function CommitDialog({ enabled }: { enabled: boolean }) {
  const { commitOpen, api } = useChrome();
  const { save } = useSave();
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  if (!enabled) return null;
  return (
    <Dialog
      open={commitOpen}
      onOpenChange={(open, details) => {
        if (open) setError(null);
        api.setCommitOpen(open, {
          reason: details.reason,
          event: details.event,
        });
      }}
    >
      <DialogBackdrop className="ed-backdrop" />
      <DialogContent className="ed-dialog" data-kind="form">
        <DialogTitle className="ed-dialog-title">
          Describe this version
        </DialogTitle>
        <form className="ed-stack" onSubmit={(event) => event.preventDefault()}>
          <Field className="ed-field" invalid={error !== null}>
            <FieldLabel className="ed-label">Commit message</FieldLabel>
            <Input
              placeholder="What changed?"
              className="ed-input"
              value={message}
              onValueChange={(value) => setMessage(value)}
            />
            {error ? (
              <p role="alert" className="ed-error">
                {error}
              </p>
            ) : null}
          </Field>
          <div className="ed-actions">
            <DialogClose className="ed-button" data-variant="outline">
              Cancel
            </DialogClose>
            <DialogClose
              type="submit"
              className="ed-button"
              data-variant="primary"
              action={async () => {
                setError(null);
                try {
                  await save({ message: message || undefined });
                  setMessage('');
                } catch (reason) {
                  setError(
                    reason instanceof Error ? reason.message : 'Saving failed.',
                  );
                  throw reason;
                }
              }}
            >
              Commit
            </DialogClose>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SaveButton() {
  const { dirty } = useSave();
  const { api } = useChrome();
  return (
    <IconButton
      label="Save"
      shortcut={SAVE_KEYS}
      size="sm"
      render={<ToolbarButton render={<Button />} />}
      data-variant="primary"
      data-size="label"
      data-dirty={dirty || undefined}
      disabled={!dirty}
      // UI SDK's Button stays pending while the Promise its press returned runs.
      // oxlint-disable-next-line typescript/no-misused-promises
      onClick={(event: React.MouseEvent) =>
        api.save({ reason: 'press', event: event.nativeEvent })
      }
    >
      <SaveIcon aria-hidden />
      <span aria-hidden>Save</span>
    </IconButton>
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
  const tool = <ToolbarButton />;

  return (
    <Chrome.Toolbar className="ed-topbar">
      <Toolbar aria-label="Toolbar" className="ed-toolbar">
        {docked ? (
          <IconButton
            label="Sidebar"
            shortcut={SIDEBAR_KEYS}
            render={
              <Toggle
                pressed={panels.left}
                onPressedChange={(open, details) =>
                  api.setPanel('left', open, {
                    reason: details.reason,
                    event: details.event,
                  })
                }
              />
            }
          >
            <PanelLeftIcon />
          </IconButton>
        ) : null}
        <Editor.Slot name="toolbar-start" />
        <IconButton
          label={undo?.label ?? 'Undo'}
          shortcut={undo?.shortcut}
          render={tool}
          disabled={!history.canUndo}
          onClick={() => history.undo()}
        >
          <Undo2Icon />
        </IconButton>
        <IconButton
          label={redo?.label ?? 'Redo'}
          shortcut={redo?.shortcut}
          render={tool}
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
                if (next) {
                  api.setDevice(next[0], {
                    reason: details.reason,
                    event: details.event,
                  });
                }
              }}
              className="ed-segmented"
            >
              {DEVICES.map(([id, label, Icon]) => (
                <Toggle key={id} value={id}>
                  <ToggleIcon>
                    <Icon />
                  </ToggleIcon>
                  <span className="ed-sr">{label}</span>
                </Toggle>
              ))}
            </ToggleGroup>
            <ToolbarSeparator className="ed-separator" />
            <IconButton
              label="Add block"
              shortcut={quickInsert?.shortcut}
              render={tool}
              onClick={(event: React.MouseEvent) =>
                api.addBlock({ reason: 'press', event: event.nativeEvent })
              }
            >
              <PlusIcon />
            </IconButton>
          </>
        ) : null}
        <span className="ed-spacer" />
        <Editor.Slot name="toolbar-end" />
        <IconButton
          label={commands?.label ?? 'Commands'}
          shortcut={commands?.shortcut}
          render={tool}
          onClick={(event: React.MouseEvent) =>
            api.openPalette('commands', {
              reason: 'press',
              event: event.nativeEvent,
            })
          }
        >
          <CommandIcon />
        </IconButton>
        {canvas && docked ? (
          <IconButton
            label="Inspector"
            render={
              <Toggle
                pressed={inspectorOpen}
                onPressedChange={(open, details) => {
                  const why = { reason: details.reason, event: details.event };
                  if (layout === 'tablet') {
                    if (open) api.openSheet('props', why);
                    else api.closeSheet(why);
                  } else api.setPanel('right', open, why);
                }}
              />
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
