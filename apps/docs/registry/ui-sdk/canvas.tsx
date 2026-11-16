// @registry ui-sdk-editor@0.3.2
'use client';

// The chrome over the canvas: rings, issue markers, insert buttons and the
// text glass on the canvas surface; the block toolbar, drop indicator and
// drag preview on the host layer, where they may leave a device frame.

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
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from '@ui-sdk/react/menu';
import { Separator } from '@ui-sdk/react/separator';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  CopyIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';

import { IconButton } from './chrome';
import { RichTextFormats } from './fields';

function CommandItem({ id }: { id: string }) {
  const command = useCommand(id);
  if (!command) return null;
  return (
    <MenuItem value={id} disabled={!command.canExecute} className="ed-item">
      {command.label ?? id}
      {command.shortcutLabel ? (
        <kbd className="ed-kbd ed-item-end">{command.shortcutLabel}</kbd>
      ) : null}
    </MenuItem>
  );
}

/** Structure actions beyond the toolbar, all reachable without a drag. */
function MoreActions({ blockId }: { blockId: string }) {
  const { targets, moveTo } = useMoveTargets(blockId);
  const wrap = useCommand('block.wrap');
  const copy = useCommand('clipboard.copy');
  const parent = useCommand('selection.parent');
  const commands = {
    'block.wrap': wrap,
    'clipboard.copy': copy,
    'selection.parent': parent,
  };
  return (
    <Menu
      onAction={(value) => {
        if (value.startsWith('move:')) {
          const target = targets[Number(value.slice(5))];
          if (target) moveTo(target.parent, target.count);
          return;
        }
        commands[value as keyof typeof commands]?.run();
      }}
    >
      <MenuTrigger
        className="ed-button"
        data-variant="ghost"
        data-size="icon-xs"
      >
        <MoreHorizontalIcon />
        <span className="ed-sr">More actions</span>
      </MenuTrigger>
      <MenuContent align="end" sideOffset={4} className="ed-popup ed-list">
        <MenuSub>
          <MenuSubTrigger disabled={targets.length === 0} className="ed-item">
            Move to…
            <ChevronRightIcon className="ed-item-end" aria-hidden />
          </MenuSubTrigger>
          <MenuSubContent className="ed-popup ed-list" data-scroll="">
            {targets.map((target, index) => (
              <MenuItem
                key={`${target.parent.id}:${target.parent.slot}`}
                value={`move:${index}`}
                className="ed-item"
                style={{ '--depth': target.depth } as React.CSSProperties}
                data-indent=""
              >
                {target.label}
              </MenuItem>
            ))}
          </MenuSubContent>
        </MenuSub>
        <MenuSeparator className="ed-separator" />
        <CommandItem id="block.wrap" />
        <CommandItem id="clipboard.copy" />
        <CommandItem id="selection.parent" />
      </MenuContent>
    </Menu>
  );
}

function BlockActions() {
  const selected = useSelection().selected;
  const actions = useBlockActions(selected ?? '');
  const palette = usePalette();
  const type = useDocSelector((doc) => doc.nodes[selected ?? '']?.type);
  if (!selected || actions.parent === null) return null;
  const label = palette.find((item) => item.type === type)?.label ?? type;
  return (
    <>
      <Canvas.DragHandle blockId={selected} className="ed-handle">
        <GripVerticalIcon />
        <span className="ed-sr">Drag to move</span>
      </Canvas.DragHandle>
      <span className="ed-toolbar-label">{label}</span>
      <Separator orientation="vertical" className="ed-separator" />
      <IconButton
        label="Move up"
        size="xs"
        disabled={!actions.canMoveUp}
        onClick={() => actions.moveUp()}
      >
        <ArrowUpIcon />
      </IconButton>
      <IconButton
        label="Move down"
        size="xs"
        disabled={!actions.canMoveDown}
        onClick={() => actions.moveDown()}
      >
        <ArrowDownIcon />
      </IconButton>
      <Separator orientation="vertical" className="ed-separator" />
      <IconButton
        label="Duplicate"
        size="xs"
        onClick={() => actions.duplicate()}
      >
        <CopyIcon />
      </IconButton>
      <IconButton label="Delete" size="xs" onClick={() => actions.remove()}>
        <Trash2Icon />
      </IconButton>
      <MoreActions blockId={selected} />
      <Editor.Slot name="block-toolbar" props={{ blockId: selected }} />
      <Canvas.InlineRichTextToolbar>
        <Separator orientation="vertical" className="ed-separator" />
        <Editor.RichTextToolbar className="ed-row">
          <RichTextFormats blocks={false} />
        </Editor.RichTextToolbar>
      </Canvas.InlineRichTextToolbar>
    </>
  );
}

/** Every overlay part of the canvas. Put it inside `Canvas.Root`. */
export function CanvasChrome({ onInsert }: { onInsert: () => void }) {
  return (
    <>
      <Canvas.Overlay>
        <Canvas.ParentRing data-slot="editor-parent-ring" />
        <Canvas.SelectionRing data-slot="editor-selection-ring" />
        <Canvas.HoverRing data-slot="editor-hover-ring" />
        <Canvas.FieldRing data-slot="editor-field-ring" />
        <Canvas.IssueMarker data-slot="editor-issue-marker" />
        {(['between', 'container'] as const).map((placement) => (
          <Canvas.InsertButton
            key={placement}
            placement={placement}
            onInsert={onInsert}
            data-slot="editor-insert-button"
          >
            <PlusIcon />
            <span className="ed-sr">Insert block</span>
          </Canvas.InsertButton>
        ))}
        <Canvas.InlineText data-slot="editor-inline-text" />
      </Canvas.Overlay>
      <Canvas.Overlay layer="host">
        <Canvas.BlockToolbar
          side="top"
          align="start"
          data-slot="editor-block-toolbar"
        >
          <BlockActions />
        </Canvas.BlockToolbar>
        <Canvas.DropIndicator data-slot="editor-drop-indicator" />
        <Canvas.DragPreview data-slot="editor-drag-preview" />
      </Canvas.Overlay>
    </>
  );
}

/** A palette row that drags a new block onto the canvas, or inserts it on press. */
export function PaletteItem(
  props: React.ComponentProps<typeof Canvas.PaletteItem>,
) {
  return <Canvas.PaletteItem data-slot="editor-palette-item" {...props} />;
}
