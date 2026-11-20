import '@/app/global.css';
import { createMemoryAdapter } from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createAgent } from '@ui-sdk/react/agent';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/ui-sdk-editor-app';

import { components, home, schema } from '../app/memory-app';

let approve = false;
const agent = createAgent({ allow: (step) => !step.confirm || approve });

afterEach(async () => {
  cleanup();
  approve = false;
  await page.viewport(1280, 800);
});

async function mount(ready = '[role="treeitem"]') {
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
  await waitFor(() => expect(document.querySelector(ready)).not.toBeNull(), {
    timeout: 10_000,
  });
  return adapter;
}

const onPage = () =>
  agent
    .snapshot()
    .filter((entry) => !entry.offPage && entry.component !== 'more');

function expectNamed(labels: readonly string[]) {
  const components = onPage();
  for (const entry of components) {
    expect(
      entry.label,
      `${entry.component} ${entry.ref} has no name`,
    ).toBeTruthy();
  }
  const present = components.map((entry) => entry.label);
  for (const label of labels) {
    expect(present, `${label} is missing from the snapshot`).toContain(label);
  }
  return components;
}

async function itemsOf(within: string) {
  const found = await agent.query({ within });
  if ('error' in found) throw new Error(found.error);
  return (found[0]?.items ?? []) as { value: string; label: string }[];
}

async function act(
  ...steps: { ref: string; action: string; args?: unknown[] }[]
) {
  const result = await agent.act({
    steps: steps.map((step) => ({ args: [], ...step })),
  });
  expect(result.ok, result.error?.message).toBe(true);
  return result;
}

const outlineLabels = () =>
  [...document.querySelectorAll('[role="treeitem"]')].map(
    (el) => el.textContent,
  );

it('names every control on desktop, with a block selected and with the palette open', async () => {
  await mount();
  const components = expectNamed([
    'Page editor',
    'Toolbar',
    'Outline',
    'Device',
    'Block or page',
    'Panel layout',
    'Browse block types',
  ]);
  const toolbar = components.find((entry) => entry.label === 'Toolbar');
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
  expect(
    components.find((entry) => entry.label === 'Page editor')?.actions,
  ).toEqual(['setDevice', 'togglePanel', 'insertBlock', 'save']);
  expect(
    components.find((entry) => entry.label === 'Outline')?.actions,
  ).toEqual(['select', 'toggle', 'move']);

  const [heading] = (await itemsOf('Outline')).filter((item) =>
    item.label.startsWith('Heading'),
  );
  await act({ ref: 'Outline', action: 'select', args: [heading!.value] });
  await waitFor(() =>
    expectNamed([
      'Text',
      'Move Heading up',
      'Move Heading down',
      'Duplicate Heading',
      'Delete Heading',
      'More actions for Heading',
    ]),
  );

  await act({ ref: 'Toolbar', action: 'press', args: ['Command palette'] });
  await waitFor(() => expectNamed(['Commands', 'Filter commands']));
});

it('selects a block, edits its field, switches the device, undoes and saves', async () => {
  const adapter = await mount();
  const outline = await itemsOf('Outline');
  expect(outline.map((item) => item.label)).toEqual([
    'Heading: Edited in memory',
    expect.stringMatching(/^Section/),
    expect.stringMatching(/^Paragraph/),
  ]);
  await act({ ref: 'Outline', action: 'select', args: [outline[0]!.value] });
  await act({ ref: 'Text', action: 'setValue', args: ['Welcome'] });
  await waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>('.ed-inspector input')?.value,
    ).toBe('Welcome'),
  );

  const mobile = onPage().find(
    (entry) => entry.component === 'toggle' && entry.label === 'Mobile',
  );
  expect(mobile?.actions).toContain('setPressed');
  await act({ ref: mobile!.ref, action: 'setPressed', args: [true] });
  await waitFor(() =>
    expect(
      document.querySelector<HTMLElement>('.ed-canvas')?.style.maxWidth,
    ).toBe('375px'),
  );

  await act({ ref: 'Toolbar', action: 'press', args: ['Undo'] });
  await waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>('.ed-inspector input')?.value,
    ).toBe('Edited in memory'),
  );
  await act({ ref: 'Text', action: 'setValue', args: ['Saved by an agent'] });
  await act({ ref: 'Toolbar', action: 'press', args: ['Save'] });
  await waitFor(() =>
    expect(adapter.get('home')?.root.slots?.children?.[0]?.props?.text).toBe(
      'Saved by an agent',
    ),
  );
});

it('edits the page, a select and inserts a block from the types it lists', async () => {
  await mount();
  await act({ ref: 'Block or page', action: 'setValue', args: ['page'] });
  await act({ ref: 'Title', action: 'setValue', args: ['Agent home'] });
  await waitFor(() =>
    expect(
      [
        ...document.querySelectorAll<HTMLInputElement>('.ed-inspector input'),
      ].some((input) => input.value === 'Agent home'),
    ).toBe(true),
  );
  await act({ ref: 'Block or page', action: 'setValue', args: ['block'] });

  const section = (await itemsOf('Outline')).find((item) =>
    item.label.startsWith('Section'),
  )!;
  await act({ ref: 'Outline', action: 'select', args: [section.value] });
  await act({ ref: 'Tone', action: 'setValue', args: ['Plain'] });
  await waitFor(() =>
    expect(
      document.querySelector('.ed-inspector .ed-select')?.textContent,
    ).toContain('Plain'),
  );

  const types = onPage().find((entry) => entry.label === 'Page editor')
    ?.items as { value: string; label: string }[] | undefined;
  const heading = types?.find((type) => type.label === 'Heading');
  expect(heading).toBeDefined();
  await act({
    ref: 'Page editor',
    action: 'insertBlock',
    args: [heading!.value],
  });
  await waitFor(() => expect(outlineLabels()).toHaveLength(4));
});

it('needs a person to delete a block or to overwrite', async () => {
  await mount();
  const [heading] = await itemsOf('Outline');
  await act({ ref: 'Outline', action: 'select', args: [heading!.value] });
  const remove = {
    steps: [{ ref: 'Delete Heading', action: 'press', args: [] }],
  };
  const refused = await agent.act(remove);
  expect(refused.ok).toBe(false);
  expect(refused.error?.message).toMatch(/Needs a person|said no/);
  expect(outlineLabels()).toHaveLength(3);
  approve = true;
  const removed = await agent.act(remove);
  expect(removed.ok, removed.error?.message).toBe(true);
  await waitFor(() => expect(outlineLabels()).toHaveLength(2));
});

it("an agent's changes reach every component that shows them, both ways", async () => {
  await mount();
  const pressed = (label: string) =>
    [...document.querySelectorAll('[role="toolbar"] button')]
      .find(
        (el) =>
          (el.getAttribute('aria-label') ?? el.textContent?.trim()) === label,
      )
      ?.hasAttribute('data-pressed');
  await act({ ref: 'Page editor', action: 'setDevice', args: ['tablet'] });
  await waitFor(() => expect(pressed('Tablet')).toBe(true));
  await waitFor(() =>
    expect(
      document.querySelector<HTMLElement>('.ed-canvas')!.style.maxWidth,
    ).toBe('768px'),
  );

  const left = () =>
    document.querySelector<HTMLElement>('.ed-panel')!.getBoundingClientRect()
      .width;
  expect(pressed('Sidebar')).toBe(true);
  await act({ ref: 'Page editor', action: 'togglePanel', args: ['left'] });
  await waitFor(() => expect(left()).toBe(0));
  expect(pressed('Sidebar')).toBe(false);
  await act({ ref: 'Page editor', action: 'togglePanel', args: ['left'] });
  await waitFor(() => expect(left()).toBeGreaterThan(150));

  await act({ ref: 'Panel layout', action: 'collapse', args: ['ed-left'] });
  await waitFor(() => expect(left()).toBe(0));
  await waitFor(() => expect(pressed('Sidebar')).toBe(false));
  await act({ ref: 'Page editor', action: 'togglePanel', args: ['left'] });
  await waitFor(() => expect(left()).toBeGreaterThan(150));

  const section = (await itemsOf('Outline')).find((item) =>
    item.label.startsWith('Section'),
  )!;
  await act({ ref: 'Outline', action: 'toggle', args: [section.value] });
  await waitFor(() => expect(outlineLabels()).toHaveLength(2));
});

it('refuses what the editor does not know, with the choices', async () => {
  await mount();
  const device = await agent.act({
    steps: [{ ref: 'Page editor', action: 'setDevice', args: ['watch'] }],
  });
  expect(device.ok).toBe(false);
  expect(device.error?.message).toMatch(/desktop, tablet, mobile/);
  const block = await agent.act({
    steps: [{ ref: 'Outline', action: 'select', args: ['footer'] }],
  });
  expect(block.ok).toBe(false);
});

it('names every control on a phone, with each sheet open', async () => {
  await page.viewport(390, 844);
  await mount('[data-slot="editor-bottom-bar"]');
  await waitFor(() => expectNamed(['Page editor', 'Toolbar']));
  for (const button of ['Add block', 'Outline', 'Properties']) {
    const bar = document.querySelector('[data-slot="editor-bottom-bar"]')!;
    await userEvent.click(
      [...bar.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === button,
      )!,
    );
    await waitFor(() =>
      expect(
        document.querySelector('[role="dialog"][data-open]'),
      ).not.toBeNull(),
    );
    expectNamed([]);
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
  }
});
