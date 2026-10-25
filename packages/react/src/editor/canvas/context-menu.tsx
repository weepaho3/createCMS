import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';

import { composeRefs, useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import { useEditorContext } from '../context';
import { isElement, isHTMLElement } from '../dom';
import { useRovingFocus } from '../roving';
import { useCanvasContext } from './context';
import { anchorsAt, contentTargetOf } from './hit';

/** The commands the default menu offers, in order. */
export const CONTEXT_MENU_COMMANDS: readonly string[] = [
  'block.duplicate',
  'clipboard.copy',
  'clipboard.paste',
  'block.remove',
  'block.moveUp',
  'block.moveDown',
  'block.wrap',
];

/** One row of the menu: a command, or selecting another block. */
export type ContextMenuEntry =
  | {
      readonly kind: 'command';
      readonly id: string;
      readonly label: string;
      readonly disabled: boolean;
    }
  | {
      readonly kind: 'select';
      /** `ancestor` rows list every parent; `below` is the block behind the pointer. */
      readonly role: 'ancestor' | 'below';
      readonly blockId: string;
      readonly label: string;
    };

type ContextMenuState = { open: boolean };

export type CanvasContextMenuProps = Omit<
  UseRenderComponentProps<'div', ContextMenuState>,
  'children'
> & {
  /** Command ids to offer; default `CONTEXT_MENU_COMMANDS`. */
  commands?: readonly string[];
  /** Renders one row; default a `menuitem` button. */
  renderItem?: (entry: ContextMenuEntry, run: () => void) => React.ReactNode;
};

type Opened = { x: number; y: number; blockId: string; below: string | null };

/** Block ids under a client point from front to back, outermost last. */
function blocksAt(host: Element, x: number, y: number): string[] {
  const out: string[] = [];
  for (const el of anchorsAt(host, x, y)) {
    const id = el
      .closest('[data-editor-block]')
      ?.getAttribute('data-editor-block');
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * A right click on a block selects it (unless it is already selected) and
 * opens a `role="menu"` at the pointer: the block commands, a row per
 * ancestor to select it, and the block behind the pointer. Arrow keys move,
 * Escape and a click elsewhere close, and focus returns to where it was.
 */
export function CanvasContextMenu({
  commands = CONTEXT_MENU_COMMANDS,
  renderItem,
  render,
  style,
  ref,
  onKeyDown,
  ...rest
}: CanvasContextMenuProps) {
  const canvas = useCanvasContext('Canvas.ContextMenu');
  const { store, schema, messages } = useEditorContext('Canvas.ContextMenu');
  const [opened, setOpened] = React.useState<Opened | null>(null);
  const roving = useRovingFocus<HTMLDivElement>({ orientation: 'vertical' });
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const returnRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    const host = canvas.host;
    if (!host || canvas.interactive === 'none') return;
    const onContextMenu = (event: MouseEvent) => {
      const target = contentTargetOf(event, host);
      if (!isElement(target)) return;
      const blockId = target
        .closest('[data-editor-block]')
        ?.getAttribute('data-editor-block');
      if (!blockId || blockId === store.getDoc().rootId) return;
      event.preventDefault();
      if (!store.getSession().selection.includes(blockId)) {
        store.select(blockId);
      }
      const { nodes } = store.getDoc();
      const ancestors = new Set<string>();
      for (let up = nodes[blockId]?.parent; up; up = nodes[up.id]?.parent) {
        ancestors.add(up.id);
      }
      const below =
        blocksAt(host, event.clientX, event.clientY).find(
          (id) => id !== blockId && !ancestors.has(id),
        ) ?? null;
      const active = host.ownerDocument.activeElement;
      returnRef.current = isHTMLElement(active) ? active : null;
      setOpened({ x: event.clientX, y: event.clientY, blockId, below });
    };
    host.addEventListener('contextmenu', onContextMenu);
    return () => host.removeEventListener('contextmenu', onContextMenu);
  }, [canvas.host, canvas.interactive, store]);

  const close = React.useCallback((restore: boolean) => {
    setOpened(null);
    const back = returnRef.current;
    returnRef.current = null;
    if (restore && back?.isConnected) back.focus();
  }, []);

  const rovingFocus = roving.focus;
  React.useLayoutEffect(() => {
    if (opened) rovingFocus();
  }, [opened, rovingFocus]);

  React.useEffect(() => {
    if (!opened) return;
    const doc = menuRef.current?.ownerDocument;
    if (!doc) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        menuRef.current &&
        isElement(target) &&
        menuRef.current.contains(target)
      ) {
        return;
      }
      close(false);
    };
    doc.addEventListener('pointerdown', onPointerDown, true);
    return () => doc.removeEventListener('pointerdown', onPointerDown, true);
  }, [opened, close]);

  const entries = React.useMemo((): ContextMenuEntry[] => {
    if (!opened) return [];
    const out: ContextMenuEntry[] = commands
      .filter((id) => store.commands.get(id))
      .map((id) => ({
        kind: 'command',
        id,
        label: messages.commands[id] ?? store.commands.get(id)?.label ?? id,
        disabled: !store.commands.canExecute(id),
      }));
    const { nodes, rootId } = store.getDoc();
    for (
      let up = nodes[opened.blockId]?.parent;
      up && up.id !== rootId;
      up = nodes[up.id]?.parent
    ) {
      const node = nodes[up.id];
      if (!node) break;
      out.push({
        kind: 'select',
        role: 'ancestor',
        blockId: up.id,
        label: messages.parts.contextSelect({
          block: describeBlock(schema, node),
        }),
      });
    }
    const belowNode = opened.below ? nodes[opened.below] : undefined;
    if (belowNode) {
      out.push({
        kind: 'select',
        role: 'below',
        blockId: belowNode.id,
        label: messages.parts.contextSelectBelow({
          block: describeBlock(schema, belowNode),
        }),
      });
    }
    return out;
  }, [opened, commands, store, schema, messages]);

  const runEntry = (entry: ContextMenuEntry) => () => {
    if (entry.kind === 'command') {
      if (entry.disabled) return;
      close(true);
      void store.commands.execute(entry.id);
      return;
    }
    close(true);
    store.select(entry.blockId);
  };

  const element = useRender<'div', ContextMenuState>({
    defaultTagName: 'div',
    render,
    props: {
      role: 'menu',
      'aria-label': messages.parts.contextMenu,
      ...rest,
      ref: composeRefs(menuRef, roving.ref, ref),
      onFocus: roving.onFocus,
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          close(true);
          return;
        }
        roving.onKeyDown(event);
      },
      style: {
        position: 'fixed',
        left: opened?.x ?? 0,
        top: opened?.y ?? 0,
        ...style,
      },
      children: entries.map((entry) => {
        const run = runEntry(entry);
        const key =
          entry.kind === 'command'
            ? entry.id
            : `${entry.role}:${entry.blockId}`;
        if (renderItem) {
          return (
            <React.Fragment key={key}>{renderItem(entry, run)}</React.Fragment>
          );
        }
        const disabled = entry.kind === 'command' && entry.disabled;
        return (
          <button
            key={key}
            type="button"
            role="menuitem"
            aria-disabled={disabled || undefined}
            data-command={entry.kind === 'command' ? entry.id : undefined}
            data-select={entry.kind === 'select' ? entry.role : undefined}
            onClick={run}
          >
            {entry.label}
          </button>
        );
      }),
    },
    state: { open: opened !== null },
  });
  return opened ? element : null;
}
