import '@/app/global.css';
import { createMemoryAdapter } from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createAgent } from '@ui-sdk/react/agent';
import { afterEach, expect, it } from 'vitest';

import { EditorApp } from '@/components/ui-sdk-editor-app';

import { components, home, schema } from '../app/memory-app';

afterEach(cleanup);

let approve = false;
const agent = createAgent({ allow: (step) => !step.confirm || approve });

async function mount() {
  const adapter = createMemoryAdapter({ home });
  render(
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <EditorApp
        adapter={adapter}
        documentId="home"
        baseVersion={adapter.version('home')}
        schema={schema}
        components={components}
      />
    </div>,
  );
  await waitFor(
    () => expect(document.querySelector('[role="treeitem"]')).not.toBeNull(),
    { timeout: 10_000 },
  );
  return adapter;
}

const outlineLabels = () =>
  [...document.querySelectorAll('[role="treeitem"]')].map(
    (el) => el.textContent,
  );

it('names every control and lists the editor actions', async () => {
  await mount();
  const components = agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== 'more');
  for (const entry of components) {
    expect(
      entry.label,
      `${entry.component} ${entry.ref} has no name`,
    ).toBeTruthy();
  }
  const labels = components.map((entry) => entry.label);
  for (const label of [
    'Page editor',
    'Outline',
    'Editor',
    'Device',
    'Search blocks',
    'Block or page',
    'Editor panels',
  ]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label);
  }
  const toolbar = components.find((entry) => entry.label === 'Editor');
  expect(toolbar?.buttons).toEqual(
    expect.arrayContaining([
      'Sidebar',
      'Undo',
      'Redo',
      'Add block',
      'Inspector',
      'Save',
    ]),
  );
  const editor = components.find((entry) => entry.label === 'Page editor');
  expect(editor?.actions).toEqual(
    expect.arrayContaining(['setDevice', 'togglePanel', 'addBlock', 'save']),
  );
  const outline = components.find((entry) => entry.label === 'Outline');
  expect(outline?.actions).toEqual(['select', 'toggle', 'move']);
});

it('selects a block, edits its field and switches the device', async () => {
  await mount();
  const tree = await agent.query({ text: 'Outline' });
  expect(Array.isArray(tree)).toBe(true);
  const heading = (
    agent.snapshot().find((entry) => entry.label === 'Outline')?.items as
      | { value: string; label: string }[]
      | undefined
  )?.find((item) => item.label === 'Heading');
  expect(heading).toBeDefined();

  const selected = await agent.act({
    steps: [{ ref: 'Outline', action: 'select', args: [heading!.value] }],
  });
  expect(selected.ok, selected.error?.message).toBe(true);
  await waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>('.ed-inspector input')?.value,
    ).toBe('Edited in memory'),
  );

  const result = await agent.act({
    steps: [
      { ref: 'Text', action: 'setValue', args: ['Welcome'] },
      { ref: 'Device', action: 'setValue', args: [['mobile']] },
    ],
  });
  expect(result.ok, result.error?.message).toBe(true);
  await waitFor(() =>
    expect(
      document.querySelector(
        '[role="toolbar"] [data-pressed][aria-label="Mobile"]',
      ),
    ).not.toBeNull(),
  );
  await waitFor(() => expect(outlineLabels()[0]).toContain('Heading'));
});

it('opens the add dialog through the editor and needs a person to delete', async () => {
  await mount();
  const open = await agent.act({
    steps: [{ ref: 'Page editor', action: 'addBlock', args: [] }],
  });
  expect(open.ok, open.error?.message).toBe(true);
  await waitFor(() =>
    expect(document.querySelector('[role="dialog"] input')).not.toBeNull(),
  );
  const close = await agent.act({
    steps: [{ ref: 'Page editor', action: 'closePalette', args: [] }],
  });
  expect(close.ok, close.error?.message).toBe(true);

  await agent.act({
    steps: [{ ref: 'Outline', action: 'select', args: [outlineIds()[0]!] }],
  });
  const remove = {
    steps: [{ ref: 'Delete', action: 'press', args: [] }],
  };
  approve = false;
  expect((await agent.act(remove)).ok).toBe(false);
  expect(outlineLabels()).toHaveLength(3);
  approve = true;
  const removed = await agent.act(remove);
  expect(removed.ok, removed.error?.message).toBe(true);
  await waitFor(() => expect(outlineLabels()).toHaveLength(2));
});

const outlineIds = () =>
  [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')].map(
    (el) =>
      (
        agent.snapshot().find((entry) => entry.label === 'Outline')?.items as
          | { value: string; label: string }[]
          | undefined
      )?.find((item) => item.label === el.textContent?.trim())?.value,
  );
