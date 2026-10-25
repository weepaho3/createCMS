// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from './core/store';

import { useEditorContext } from './context';
import { makeDoc, storeSchema } from './core/store/fixtures';
import { Editor } from './index';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function mount(platform: 'apple' | 'other') {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeDoc()}
      platform={platform}
    >
      <StoreProbe probe={probe} />
      <button type="button" data-testid="opener" />
      <Editor.ShortcutHelp data-testid="help" />
    </Editor.Root>,
  );
  return { ...utils, store: probe.store! };
}

describe('Editor.ShortcutHelp', () => {
  it('is hidden until the ui.shortcutHelp command opens it', () => {
    const { getByTestId, store } = mount('other');
    const help = getByTestId('help');
    expect(help.hidden).toBe(true);
    act(() => {
      store.commands.execute('ui.shortcutHelp');
    });
    expect(help.hidden).toBe(false);
    expect(help.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(help);
  });

  it('lists every bound command with platform labels', () => {
    const apple = mount('apple');
    const undo = apple
      .getByTestId('help')
      .querySelector('[data-command="history.undo"]');
    expect(undo?.textContent).toBe('Undo⌘Z');
    cleanup();
    const other = mount('other');
    const redo = other
      .getByTestId('help')
      .querySelector('[data-command="history.redo"]');
    expect(redo?.textContent).toBe('RedoCtrl+Shift+ZCtrl+Y');
    const move = other
      .getByTestId('help')
      .querySelector('[data-command="block.moveUp"]');
    expect(move?.textContent).toBe('Move upAlt+↑');
  });

  it('Escape closes it and returns focus', () => {
    const { getByTestId, store } = mount('other');
    getByTestId('opener').focus();
    act(() => {
      store.commands.execute('ui.shortcutHelp');
    });
    fireEvent.keyDown(getByTestId('help'), { key: 'Escape' });
    expect(getByTestId('help').hidden).toBe(true);
    expect(document.activeElement).toBe(getByTestId('opener'));
  });
});
