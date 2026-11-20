import '@/app/global.css';
import { createMemoryAdapter } from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createAgent } from '@ui-sdk/react/agent';
import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/ui-sdk-editor-app';

import { components, home, schema } from '../app/memory-app';

let approve = false;
const agent = createAgent({ allow: (step) => !step.confirm || approve });

afterEach(() => {
  cleanup();
  approve = false;
});

const dialog = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"]');
const textInput = () =>
  document.querySelector<HTMLInputElement>('.ed-inspector input');

async function conflict() {
  const adapter = createMemoryAdapter({ home });
  render(
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <EditorApp
        adapter={adapter}
        documentId="home"
        baseVersion="0"
        schema={schema}
        components={components}
      />
    </div>,
  );
  const heading = await waitFor(
    () => {
      const row = [
        ...document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
      ].find((el) => el.textContent?.includes('Heading'));
      expect(row).toBeDefined();
      return row!;
    },
    { timeout: 10_000 },
  );
  await userEvent.click(heading);
  await waitFor(() => expect(textInput()).not.toBeNull());
  await userEvent.click(textInput()!);
  await userEvent.keyboard('!');
  await userEvent.keyboard('{ControlOrMeta>}s{/ControlOrMeta}');
  await waitFor(() => expect(dialog()).not.toBeNull(), { timeout: 10_000 });
  return adapter;
}

it('Escape keeps the conflict open and the edits, focus starts on the safe answer', async () => {
  await conflict();
  await waitFor(() =>
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Copy my version',
    ),
  );
  await userEvent.keyboard('{Escape}');
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(dialog()).not.toBeNull();
  expect(textInput()?.value).toBe('Edited in memory!');
});

it('an agent can neither close it nor load the server version without a person', async () => {
  await conflict();
  const entry = agent
    .snapshot()
    .find((item) => item.component === 'alert-dialog' && !item.offPage);
  expect(entry?.label).toBe('Document conflict');
  const close = await agent.act({
    steps: [{ ref: entry!.ref, action: 'setOpen', args: [false] }],
  });
  expect(dialog()).not.toBeNull();
  void close;
  const reload = {
    steps: [
      {
        ref: 'Document conflict',
        action: 'press',
        args: ['Load server version'],
      },
    ],
  };
  const refused = await agent.act(reload);
  expect(refused.ok).toBe(false);
  expect(refused.error?.message).toMatch(/Needs a person|said no/);
  expect(textInput()?.value).toBe('Edited in memory!');
  approve = true;
  const loaded = await agent.act(reload);
  expect(loaded.ok, loaded.error?.message).toBe(true);
  await waitFor(() => expect(dialog()).toBeNull());
});
