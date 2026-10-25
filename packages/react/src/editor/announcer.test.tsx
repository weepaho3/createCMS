// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorStore } from './core/store';
import { counterGenId, makeDoc, storeSchema } from './core/store/fixtures';
import { Editor } from './index';

afterEach(cleanup);

function mount(
  messages?: React.ComponentProps<typeof Editor.Root>['messages'],
) {
  const store = createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
    genId: counterGenId(),
  });
  const utils = render(
    <Editor.Root store={store} messages={messages}>
      <Editor.LiveAnnouncer />
    </Editor.Root>,
  );
  const region = utils.container.querySelector('[data-editor-live-announcer]')!;
  return { store, region };
}

describe('Editor.LiveAnnouncer', () => {
  it('is a polite status region', () => {
    const { region } = mount();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('announces inserts, moves and removals with label, excerpt and 1-based position', () => {
    const { store, region } = mount();
    act(() => {
      store.move('h1', { parent: { id: 'root_1' }, index: 1 });
    });
    expect(region.textContent).toBe(
      'Heading "Hello" moved to position 2 of 2 in the page.',
    );
    act(() => {
      store.add('heading', { parent: { id: 'sec1' }, props: { text: 'New' } });
    });
    expect(region.textContent).toBe(
      'Heading "New" added at position 2 of 2 in Section.',
    );
    act(() => {
      store.remove('p1');
    });
    expect(region.textContent).toBe('Paragraph "World" removed.');
  });

  it('announces undo and redo, and inline editing start and end', () => {
    const { store, region } = mount();
    act(() => {
      store.update('h1', { text: 'X' });
      store.undo();
    });
    expect(region.textContent).toBe('Undone.');
    act(() => {
      store.redo();
    });
    expect(region.textContent).toBe('Redone.');
    act(() => {
      store.setEditing({ blockId: 'h1', key: 'text' });
    });
    expect(region.textContent).toBe('Editing Text of Heading "X".');
    act(() => {
      store.setEditing(null);
    });
    expect(region.textContent).toBe('Stopped editing Text.');
  });

  it('a prop edit is not announced; texts come from the catalog', () => {
    const { store, region } = mount({
      announce: { removed: ({ block }) => `${block.label} entfernt.` },
    });
    act(() => {
      store.update('h1', { text: 'quiet' });
    });
    expect(region.textContent).toBe('');
    act(() => {
      store.remove('h1');
    });
    expect(region.textContent).toBe('Heading entfernt.');
  });
});
