import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';

import { composeRefs, useRender } from '../use-render';
import { useEditorContext } from './context';
import { isHTMLElement } from './dom';
import { useShortcutLabel } from './messages';

/** One command in the shortcut list. */
export type ShortcutEntry = {
  readonly id: string;
  /** From the catalog, else the command's own label, else its id. */
  readonly label: string;
  /** Formatted for the editor's platform (`⌘⇧Z`, `Ctrl+Shift+Z`). */
  readonly keys: readonly string[];
};

/**
 * Every bound command with its formatted combos, in binding order; combos
 * of unregistered commands are left out.
 */
export function useShortcutList(): readonly ShortcutEntry[] {
  const { store, messages } = useEditorContext('useShortcutList');
  const format = useShortcutLabel();
  return React.useMemo(() => {
    const byId = new Map<string, string[]>();
    for (const [combo, id] of Object.entries(store.commands.shortcuts())) {
      if (!store.commands.get(id)) continue;
      const keys = byId.get(id) ?? [];
      keys.push(format(combo));
      byId.set(id, keys);
    }
    return [...byId].map(([id, keys]) => ({
      id,
      label: messages.commands[id] ?? store.commands.get(id)?.label ?? id,
      keys,
    }));
  }, [store, messages, format]);
}

type ShortcutHelpState = { open: boolean };

export type EditorShortcutHelpProps = UseRenderComponentProps<
  'div',
  ShortcutHelpState
> & {
  /** Controlled open state. */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The shortcut list as a non-modal dialog: opens on the `ui.shortcutHelp`
 * command (`?`, `Mod+/`), closes on Escape or its close button and returns
 * focus to where it was. Children replace the default list.
 */
export function EditorShortcutHelp(props: EditorShortcutHelpProps) {
  const {
    open: openProp,
    defaultOpen = false,
    onOpenChange,
    render,
    children,
    ref,
    onKeyDown,
    ...rest
  } = props;
  const { store, messages } = useEditorContext('Editor.ShortcutHelp');
  const entries = useShortcutList();
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const titleId = React.useId();
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const returnRef = React.useRef<HTMLElement | null>(null);

  const setOpen = React.useCallback(
    (next: boolean) => {
      setOpenState(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action !== 'shortcutHelp') return;
        const active = elRef.current?.ownerDocument.activeElement ?? null;
        returnRef.current = isHTMLElement(active) ? active : null;
        setOpen(true);
      }),
    [store, setOpen],
  );

  React.useLayoutEffect(() => {
    if (open) elRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    const back = returnRef.current;
    returnRef.current = null;
    if (back?.isConnected) back.focus();
  };

  const list = (
    <dl>
      {entries.map((entry) => (
        <div key={entry.id} data-command={entry.id}>
          <dt>{entry.label}</dt>
          {entry.keys.map((key) => (
            <dd key={key}>
              <kbd>{key}</kbd>
            </dd>
          ))}
        </div>
      ))}
    </dl>
  );

  const element = useRender<'div', ShortcutHelpState>({
    defaultTagName: 'div',
    render,
    props: {
      role: 'dialog',
      'aria-labelledby': titleId,
      tabIndex: -1,
      hidden: !open,
      ...rest,
      ref: composeRefs(elRef, ref),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.key !== 'Escape') return;
        event.preventDefault();
        close();
      },
      children: (
        <>
          <h2 id={titleId}>{messages.parts.shortcutsTitle}</h2>
          {children ?? list}
          <button type="button" onClick={close}>
            {messages.parts.shortcutsClose}
          </button>
        </>
      ),
    },
    state: { open },
  });
  return element;
}
