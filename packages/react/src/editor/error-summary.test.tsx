// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BeforeSaveGate, EditorStore } from './core/store';

import { useEditorContext } from './context';
import { requireValidDocument } from './core/store';
import { makeDoc, storeSchema } from './core/store/fixtures';
import { Editor } from './index';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function mount(beforeSave: BeforeSaveGate) {
  const save = vi.fn(async () => ({ version: 'v2' }));
  const doc = makeDoc();
  doc.root.props.title = '';
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={doc}
      persistence={{ save, autosave: false }}
      beforeSave={beforeSave}
    >
      <StoreProbe probe={probe} />
      <Editor.ErrorSummary data-testid="summary" />
      <Editor.Form blockId="root_1" data-testid="form" />
    </Editor.Root>,
  );
  return { ...utils, store: probe.store!, save };
}

const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('beforeSave gate and Editor.ErrorSummary', () => {
  it('a blocked save shows the summary, and an entry focuses the field', async () => {
    const { store, save, getByTestId, queryByTestId } = mount(
      requireValidDocument(),
    );
    expect(queryByTestId('summary')).toBeNull();
    await act(async () => {
      await store.save({ force: true });
    });
    expect(save).not.toHaveBeenCalled();
    expect(store.getSession().save.status).toBe('invalid');
    const summary = getByTestId('summary');
    expect(summary.getAttribute('role')).toBe('alert');
    expect(summary.querySelector('h2')?.textContent).toBe('1 problem to fix');
    expect(document.activeElement).toBe(summary);
    const entry = summary.querySelector('button')!;
    expect(entry.textContent).toContain('Title: This field is required.');
    fireEvent.click(entry);
    await tick();
    expect(store.getSession().selection).toEqual(['root_1']);
    const active = document.activeElement;
    expect(active?.tagName).toBe('INPUT');
    expect(getByTestId('form').contains(active)).toBe(true);
  });

  it('a save that passes the gate clears the summary', async () => {
    const { store, save, queryByTestId } = mount(requireValidDocument());
    await act(async () => {
      await store.save({ force: true });
    });
    act(() => {
      store.update('root_1', { title: 'Home' });
    });
    await act(async () => {
      await store.save();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phase: 'save' }),
    );
    expect(queryByTestId('summary')).toBeNull();
  });

  it('autosave is not gated by requireValidDocument; publish passes its phase', async () => {
    const phases: string[] = [];
    const { store } = mount(({ phase }) => {
      phases.push(phase);
      return [];
    });
    await act(async () => {
      await store.save({ force: true, phase: 'publish' });
    });
    expect(phases).toEqual(['publish']);
    const gate = requireValidDocument();
    const result = await gate({
      doc: store.getDocument(),
      ops: [],
      phase: 'autosave',
      schema: storeSchema,
    });
    expect(result).toEqual([]);
  });
});
