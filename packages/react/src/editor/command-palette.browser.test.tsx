import { cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { defineEditorPlugin } from './core/plugin';
import { defineEditorSchema } from './core/schema';
import {
  Editor,
  useCommand,
  useCommands,
  useEditor,
  useEditorKeyboard,
  useEditorStore,
} from './index';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: { badge: { label: 'Badge', fields: {} } },
});

const doc = {
  schemaVersion: 1,
  root: { id: 'r', type: 'root', props: {}, slots: { children: [] } },
};

const plugin = defineEditorPlugin({
  name: 'badges',
  commands: {
    'badge.add': {
      label: 'Add badge',
      run: (store) => store.add('badge', { parent: { id: 'r' } }),
    },
  },
  shortcuts: { 'Mod+Shift+b': 'badge.add' },
  slots: {
    'toolbar-end': () => <button type="button">Plugin action</button>,
  },
});

function Option({
  id,
  active,
  onRun,
}: {
  id: string;
  active: boolean;
  onRun: () => void;
}) {
  const command = useCommand(id);
  if (!command) return null;
  return (
    <li
      id={`cmd-${id.replace('.', '-')}`}
      role="option"
      aria-selected={active}
      aria-disabled={!command.canExecute || undefined}
      aria-keyshortcuts={command.ariaKeyShortcuts}
      onClick={onRun}
    >
      {command.label ?? id}
      {command.shortcutLabel ? <kbd>{command.shortcutLabel}</kbd> : null}
    </li>
  );
}

/** A minimal command palette over the registry, opened by `ui.commandPalette`. */
function Palette() {
  const store = useEditorStore();
  const ids = useCommands()
    .map((command) => command.id)
    .filter((id) => id !== 'ui.commandPalette');
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action === 'commandPalette') setOpen(true);
      }),
    [store],
  );
  if (!open) return null;
  const shown = ids.filter((id) => {
    const label = store.commands.get(id)?.label ?? id;
    return `${label} ${id}`.toLowerCase().includes(query.toLowerCase());
  });
  const run = (id: string) => {
    setOpen(false);
    store.commands.execute(id);
  };
  const current = shown[Math.min(active, shown.length - 1)];
  return (
    <div role="dialog" aria-modal="true" aria-label="Commands">
      <input
        role="combobox"
        aria-label="Search commands"
        aria-expanded="true"
        aria-controls="cmd-list"
        aria-activedescendant={
          current ? `cmd-${current.replace('.', '-')}` : undefined
        }
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- on purpose: a dialog moves focus into its search field.
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, shown.length - 1));
          } else if (event.key === 'Enter' && current) {
            event.preventDefault();
            run(current);
          }
        }}
      />
      <ul id="cmd-list" role="listbox" aria-label="Commands">
        {shown.map((id, index) => (
          <Option
            key={id}
            id={id}
            active={id === current && index === shown.indexOf(current)}
            onRun={() => run(id)}
          />
        ))}
      </ul>
    </div>
  );
}

function Count() {
  const count = useEditor((s) => s.nodes.r?.slots.children?.length ?? 0);
  return <output data-testid="count">{count}</output>;
}

function Shell() {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useEditorKeyboard(ref);
  return (
    <div ref={ref} data-testid="scope">
      <button type="button" data-testid="focus">
        Canvas
      </button>
      <Editor.Slot name="toolbar-end" />
      <Palette />
      <Count />
    </div>
  );
}

describe('command palette over the registry', () => {
  it('Mod+K lists registered commands; the keyboard runs one; no axe violations', async () => {
    const { getByTestId, getByRole, queryByRole } = render(
      <Editor.Root schema={schema} defaultValue={doc} plugins={[plugin]}>
        <Shell />
      </Editor.Root>,
    );
    expect(getByRole('button', { name: 'Plugin action' })).toBeTruthy();
    let windowHotkey = 0;
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key === 'k') windowHotkey += 1;
    };
    window.addEventListener('keydown', onWindowKey);
    getByTestId('focus').focus();
    await userEvent.keyboard('{ControlOrMeta>}k{/ControlOrMeta}');
    window.removeEventListener('keydown', onWindowKey);
    // The editor handled Mod+K: an app-wide hotkey on the same combo stays quiet.
    expect(windowHotkey).toBe(0);
    const input = await waitFor(() =>
      getByRole('combobox', { name: 'Search commands' }),
    );
    const options = getByRole('listbox').querySelectorAll('[role="option"]');
    const labels = [...options].map((option) => option.textContent ?? '');
    expect(labels.some((label) => label.startsWith('Undo'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Add badge'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Command palette'))).toBe(
      false,
    );

    const results = await axe.run(getByRole('dialog'), {
      rules: { region: { enabled: false } },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);

    expect(document.activeElement).toBe(input);
    await userEvent.keyboard('badge');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(queryByRole('dialog')).toBeNull());
    expect(getByTestId('count').textContent).toBe('1');
  });
});
