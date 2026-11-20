import '@/app/global.css';
import {
  type AnyEditorSchema,
  createMemoryAdapter,
  defineEditorSchema,
  plainTextToRichText,
  richTextToPlainText,
  type EditorDocument,
} from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createAgent } from '@ui-sdk/react/agent';
import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/ui-sdk-editor-app';

import { components, home, schema } from '../app/memory-app';

afterEach(cleanup);

const agent = createAgent();

const rows = () => [
  ...document.querySelectorAll<HTMLElement>(
    '[data-slot="editor-outline"] [role="treeitem"]',
  ),
];
const row = (label: string) =>
  rows().find((el) => el.textContent?.includes(label))!;

async function mount(doc = home, editorSchema: AnyEditorSchema = schema) {
  const adapter = createMemoryAdapter({ home: doc });
  render(
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <EditorApp
        adapter={adapter}
        documentId="home"
        baseVersion={adapter.version('home')}
        schema={editorSchema}
        components={components}
      />
    </div>,
  );
  await waitFor(() => expect(rows().length).toBeGreaterThan(0), {
    timeout: 10_000,
  });
  return adapter;
}

const editable = () =>
  document.querySelector<HTMLElement>(
    '.ed-inspector [role="textbox"][contenteditable]',
  );

it('names the rich text field from its label, for people and agents', async () => {
  await mount();
  await userEvent.click(row('Paragraph'));
  await waitFor(() => expect(editable()).not.toBeNull(), { timeout: 10_000 });
  const label = document.getElementById(
    editable()!.getAttribute('aria-labelledby')!,
  );
  expect(label?.textContent).toBe('Body');
  const entry = agent
    .snapshot()
    .find((item) => item.component === 'editor-rich-text' && !item.offPage);
  expect(entry?.label).toBe('Body');
  expect(entry?.actions).toEqual(['setValue']);
  expect(String(entry?.value)).toContain('createMemoryAdapter');
});

it('an agent sets the text and it reaches the document', async () => {
  const adapter = await mount();
  await userEvent.click(row('Paragraph'));
  await waitFor(() => expect(editable()).not.toBeNull(), { timeout: 10_000 });
  const result = await agent.act({
    steps: [{ ref: 'Body', action: 'setValue', args: ['Agents write here.'] }],
  });
  expect(result.ok, result.error?.message).toBe(true);
  await waitFor(() =>
    expect(editable()?.textContent).toBe('Agents write here.'),
  );
  await waitFor(
    () => {
      const p1 =
        adapter.get('home')?.root.slots?.children?.[1]?.slots?.children?.[0];
      expect(richTextToPlainText(p1?.props?.body as never)).toBe(
        'Agents write here.',
      );
    },
    { timeout: 10_000 },
  );
});

it('the formatting toolbar is a UI SDK toolbar of toggles', async () => {
  await mount();
  await userEvent.click(row('Paragraph'));
  await waitFor(() => expect(editable()).not.toBeNull(), { timeout: 10_000 });
  const toolbar = document.querySelector(
    '[role="toolbar"][aria-label="Body formatting"]',
  )!;
  expect(toolbar).not.toBeNull();
  const bold = toolbar.querySelector<HTMLButtonElement>(
    '[aria-label="Bold Body"]',
  )!;
  expect(bold.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(editable()!);
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
  await userEvent.click(bold);
  await waitFor(() => expect(bold.getAttribute('aria-pressed')).toBe('true'));
  expect(editable()!.querySelector('strong')).not.toBeNull();
});

it('rich text inside a list renders without throwing', async () => {
  const listSchema = defineEditorSchema({
    root: { label: 'Page', fields: {}, slots: { children: {} } },
    components: {
      faq: {
        label: 'FAQ',
        fields: {
          answers: {
            type: 'list',
            label: 'Answers',
            of: { type: 'richText', label: 'Answer' },
          },
        },
      },
    },
  });
  const doc: EditorDocument = {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'f1',
            type: 'faq',
            props: { answers: [plainTextToRichText('First answer')] },
          },
        ],
      },
    },
  };
  await mount(doc, listSchema);
  await userEvent.click(row('FAQ'));
  await waitFor(
    () =>
      expect(
        document.querySelector('.ed-inspector [role="textbox"]')?.textContent,
      ).toBe('First answer'),
    { timeout: 10_000 },
  );
});
