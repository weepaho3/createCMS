import type * as React from 'react';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { EditorDocument } from '../core/document';
import type { RichTextDoc } from '../core/richtext/types';
import type { EditorStore } from '../core/store';

import { useEditorContext } from '../context';
import { defineEditorSchema } from '../core/schema';
import { Editor } from '../index';
import { createTiptapAdapter } from './index';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Pages', fields: {}, slots: { children: {} } },
  components: {
    note: {
      label: 'Note',
      fields: {
        body: {
          type: 'richText',
          label: 'Body',
          marks: ['bold', 'italic', 'link'],
          nodes: ['hardBreak'],
        },
      },
    },
  },
});

const doc = (text: string): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function tree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'root',
      props: {},
      slots: {
        children: [{ id: 'n1', type: 'note', props: { body: doc('Hello') } }],
      },
    },
  };
}

type Bag = { store: EditorStore | null };

function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

function setup(control: React.ReactNode = <Editor.FieldControl />) {
  const bag: Bag = { store: null };
  const utils = render(
    <Editor.Root
      schema={schema}
      defaultValue={tree()}
      richText={createTiptapAdapter()}
    >
      <Probe bag={bag} />
      <Editor.Field blockId="n1" name="body">
        <Editor.FieldLabel />
        {control}
      </Editor.Field>
    </Editor.Root>,
  );
  const store = bag.store!;
  const body = () => store.getDoc().nodes.n1!.props.body as RichTextDoc;
  return { ...utils, store, body };
}

async function editable(container: HTMLElement): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found = container.querySelector<HTMLElement>('[contenteditable="true"]');
    expect(found).not.toBeNull();
  });
  return found!;
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

describe('Tiptap rich text adapter', () => {
  it('edits the field: text and marks become JSON, the label points at the editor', async () => {
    const { container, body } = setup();
    const el = await editable(container);
    expect(el.textContent).toBe('Hello');
    expect(el.getAttribute('role')).toBe('textbox');
    const label = container.querySelector('label')!;
    expect(el.id).toBe(label.htmlFor);
    await userEvent.click(el);
    await userEvent.keyboard('{End} world');
    await waitFor(() => expect(body()).toEqual(doc('Hello world')));
    await userEvent.keyboard(`{${mod}>}b{/${mod}}!`);
    await waitFor(() =>
      expect(body().content?.[0]?.content?.at(-1)).toEqual({
        type: 'text',
        text: '!',
        marks: [{ type: 'bold' }],
      }),
    );
  });

  it('keeps out formatting the field does not allow, typed or pasted', async () => {
    const { container, body } = setup();
    const el = await editable(container);
    await userEvent.click(el);
    await userEvent.keyboard('{Enter}# Title');
    await waitFor(() => expect(el.textContent).toContain('Title'));
    expect(el.querySelector('h1')).toBeNull();
    const data = new DataTransfer();
    data.setData('text/html', '<h2>Big</h2><p><u>under</u> <b>bold</b></p>');
    data.setData('text/plain', 'Big under bold');
    const paste = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    // Firefox keeps a constructed paste event's data unreadable.
    if (!paste.clipboardData?.getData('text/html')) return;
    act(() => {
      el.dispatchEvent(paste);
    });
    await waitFor(() => expect(el.textContent).toContain('bold'));
    expect(el.querySelector('h2, u')).toBeNull();
    const types = JSON.stringify(body());
    expect(types).not.toContain('"heading"');
    expect(types).not.toContain('"underline"');
  });

  it('undo runs through the editor store and restores the JSON', async () => {
    const { container, body, store } = setup();
    const el = await editable(container);
    await userEvent.click(el);
    await userEvent.keyboard('{End}!!');
    await waitFor(() => expect(body()).toEqual(doc('Hello!!')));
    expect(store.getSession().history.canUndo).toBe(true);
    await userEvent.keyboard(`{${mod}>}z{/${mod}}`);
    await waitFor(() => expect(body()).toEqual(doc('Hello')));
    await waitFor(() => expect(el.textContent).toBe('Hello'));
  });

  it('the toolbar formats the selection without taking the focus', async () => {
    const { container, body, getByRole, queryByRole } = setup();
    const el = await editable(container);
    const toolbar = await waitFor(() =>
      getByRole('toolbar', { name: 'Formatting' }),
    );
    const bold = getByRole('button', { name: 'Bold' });
    // Only the formatting the field allows gets a button.
    expect(queryByRole('button', { name: 'Underline' })).toBeNull();
    expect(toolbar.contains(bold)).toBe(true);
    await userEvent.click(el);
    await userEvent.keyboard(`{${mod}>}a{/${mod}}`);
    await userEvent.click(bold);
    await waitFor(() =>
      expect(body().content?.[0]?.content?.[0]?.marks).toEqual([
        { type: 'bold' },
      ]),
    );
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(el.ownerDocument.activeElement).toBe(el);
  });

  it('suggests variables after {{ and inserts one by keyboard', async () => {
    const items = (query: string) =>
      ['company', 'city', 'name']
        .filter((key) => key.startsWith(query))
        .map((key) => ({ label: key, insertText: `{{${key}}}` }));
    const { container, body, findByRole } = setup(
      <Editor.RichTextField suggest={{ items }} />,
    );
    const el = await editable(container);
    await userEvent.click(el);
    await userEvent.keyboard('{End} {{{{c');
    const list = await findByRole('listbox', { name: 'Suggestions' });
    expect(
      Array.from(list.querySelectorAll('[role="option"]')).map(
        (o) => o.textContent,
      ),
    ).toEqual(['company', 'city']);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(body()).toEqual(doc('Hello {{city}}')));
    await waitFor(() =>
      expect(container.querySelector('[role="listbox"]')).toBeNull(),
    );
  });
});
