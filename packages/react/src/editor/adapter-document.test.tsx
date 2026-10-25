// @vitest-environment happy-dom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { UseAdapterDocumentResult } from './adapter-document';
import type { EditorDocument } from './core/document';

import { useAdapterDocument } from './adapter-document';
import { createMemoryAdapter } from './core/memory-adapter';
import { defineEditorSchema } from './core/schema';
import { Editor, useSave } from './index';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: {
    label: 'Page',
    fields: { title: { type: 'text', label: 'Title' } },
    slots: { children: {} },
  },
  components: {},
});

const doc: EditorDocument = {
  schemaVersion: 1,
  root: { id: 'root', type: 'root', props: { title: 'Home' } },
};

describe('useAdapterDocument', () => {
  it('loads, edits and saves through a memory adapter', async () => {
    const adapter = createMemoryAdapter({ home: doc });
    const probe: { result: UseAdapterDocumentResult | null } = {
      result: null,
    };
    let save: (() => Promise<unknown>) | null = null;
    function Saver() {
      save = useSave().save;
      return null;
    }
    function App() {
      const result = useAdapterDocument({
        adapter,
        id: 'home',
        baseVersion: adapter.version('home'),
        autosave: false,
      });
      probe.result = result;
      if (!result.doc) return null;
      return (
        <Editor.Root
          key={result.key}
          schema={schema}
          defaultValue={result.doc}
          persistence={result.persistence}
        >
          <Editor.Field blockId="root" name="title">
            <Editor.FieldControl />
          </Editor.Field>
          <Saver />
        </Editor.Root>
      );
    }
    const { container } = render(<App />);
    expect(probe.result?.status).toBe('loading');
    await waitFor(() => expect(probe.result?.status).toBe('idle'));
    const input = container.querySelector('input')!;
    expect(input.value).toBe('Home');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'Start');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      await save!();
    });
    expect(adapter.get('home')?.root.props.title).toBe('Start');
    expect(adapter.version('home')).toBe('2');
  });

  it('reports a failed load', async () => {
    const adapter = createMemoryAdapter({});
    const probe: { result: UseAdapterDocumentResult | null } = {
      result: null,
    };
    function App() {
      probe.result = useAdapterDocument({ adapter, id: 'missing' });
      return null;
    }
    render(<App />);
    await waitFor(() => expect(probe.result?.status).toBe('error'));
    expect(probe.result?.error?.kind).toBe('not-found');
    expect(probe.result?.doc).toBeNull();
  });
});
