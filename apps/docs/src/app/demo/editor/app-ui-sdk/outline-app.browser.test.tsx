import '@/app/global.css';
import { createMemoryAdapter } from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/ui-sdk-editor-app';

import { components, home, schema } from '../app/memory-app';

afterEach(cleanup);

const rows = () => [
  ...document.querySelectorAll<HTMLElement>(
    '[data-slot="editor-outline"] [role="treeitem"]',
  ),
];
const row = (label: string) =>
  rows().find((el) => el.textContent?.includes(label))!;
const levels = () =>
  rows().map((el) => `${el.getAttribute('aria-level')} ${el.textContent}`);

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
  await waitFor(() => expect(rows().length).toBe(3), { timeout: 10_000 });
  return adapter;
}

it('moves a block into a section with the keyboard and saves it', async () => {
  const adapter = await mount();
  row('Heading').focus();
  await userEvent.keyboard(' ');
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.keyboard(' ');
  await waitFor(() =>
    expect(levels()).toEqual(['1 Section', '2 Heading', '2 Paragraph']),
  );
  await waitFor(
    () => {
      const doc = adapter.get('home');
      expect(doc?.root.slots?.children).toHaveLength(1);
    },
    { timeout: 10_000 },
  );
});

it('Escape puts a picked up block back', async () => {
  await mount();
  row('Heading').focus();
  await userEvent.keyboard(' ');
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.keyboard('{Escape}');
  await waitFor(() =>
    expect(levels()).toEqual(['1 Heading', '1 Section', '2 Paragraph']),
  );
});

it('closes and opens a section from the outline', async () => {
  await mount();
  row('Section').focus();
  await userEvent.keyboard('{ArrowLeft}');
  await waitFor(() => expect(levels()).toEqual(['1 Heading', '1 Section']));
  expect(row('Section').getAttribute('aria-expanded')).toBe('false');
  await userEvent.keyboard('{ArrowRight}');
  await waitFor(() => expect(rows()).toHaveLength(3));
});

it('focus stays in the outline when its branch closes', async () => {
  await mount();
  row('Paragraph').focus();
  await userEvent.click(row('Section').querySelector('.ed-tree-toggle')!);
  await waitFor(() => expect(rows()).toHaveLength(2));
  await waitFor(() => expect(document.activeElement).toBe(row('Section')));
});

it('Mod+Z in the command palette stays in the palette', async () => {
  const adapter = await mount();
  await userEvent.click(row('Heading'));
  const input = document.querySelector<HTMLInputElement>(
    '.ed-inspector input',
  )!;
  await userEvent.click(input);
  await userEvent.keyboard('X');
  await waitFor(() => expect(input.value).toBe('Edited in memoryX'));
  row('Heading').focus();
  await userEvent.keyboard('{ControlOrMeta>}k{/ControlOrMeta}');
  await waitFor(() =>
    expect(document.querySelector('[role="dialog"] input')).not.toBeNull(),
  );
  await userEvent.keyboard('ab{ControlOrMeta>}z{/ControlOrMeta}');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await userEvent.keyboard('{Escape}{Escape}');
  await waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>('.ed-inspector input')?.value,
    ).toBe('Edited in memoryX'),
  );
  void adapter;
});

it('Mod+B in a text field types, it does not toggle the sidebar', async () => {
  await mount();
  await userEvent.click(row('Heading'));
  await userEvent.click(
    document.querySelector<HTMLInputElement>('.ed-inspector input')!,
  );
  await userEvent.keyboard('{ControlOrMeta>}b{/ControlOrMeta}');
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(
    document
      .querySelector('[role="toolbar"] [aria-label="Sidebar"]')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');
});
