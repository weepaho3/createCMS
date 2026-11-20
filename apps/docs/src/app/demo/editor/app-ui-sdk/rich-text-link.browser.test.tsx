import '@/app/global.css';
import type { RichTextDoc } from '@createcms/react/editor/core';

import { createMemoryAdapter } from '@createcms/react/editor/core';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Button } from '@ui-sdk/react/button';
import * as React from 'react';
import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/ui-sdk-editor-app';

import { RichTextLinksProvider } from '../../../../../registry/ui-sdk/rich-text-link';
import { components, home, schema } from '../app/memory-app';

afterEach(cleanup);

const links = {
  collections: ['pages'],
  renderPagePicker: ({
    onChange,
    label,
  }: {
    onChange: (rootId: string) => void;
    label: string;
  }) => (
    <Button className="ed-button" onClick={() => onChange('about')}>
      {`Pick About for ${label}`}
    </Button>
  ),
};

function mount(withPages = false) {
  const adapter = createMemoryAdapter({ home });
  const store: { body: () => RichTextDoc | undefined } = {
    body: () =>
      adapter.get('home')?.root.slots?.children?.[1]?.slots?.children?.[0]
        ?.props?.body as RichTextDoc | undefined,
  };
  render(
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <EditorApp
        adapter={adapter}
        documentId="home"
        baseVersion={adapter.version('home')}
        schema={schema}
        components={components}
        renderProviders={
          withPages
            ? (children: React.ReactNode) => (
                <RichTextLinksProvider value={links}>
                  {children}
                </RichTextLinksProvider>
              )
            : undefined
        }
      />
    </div>,
  );
  return store;
}

const linkMarks = (doc: RichTextDoc | undefined) =>
  (doc?.content ?? [])
    .flatMap((p) => p.content ?? [])
    .flatMap((n) => n.marks ?? [])
    .filter((m) => m.type === 'link');

const editable = () =>
  document.querySelector<HTMLElement>(
    '.ed-inspector [role="textbox"][contenteditable]',
  );

async function selectAllInInspector() {
  const row = await waitFor(
    () => {
      const el = [
        ...document.querySelectorAll<HTMLElement>('[role="treeitem"]'),
      ].find((r) => r.textContent?.includes('Paragraph'));
      expect(el).toBeDefined();
      return el!;
    },
    { timeout: 10_000 },
  );
  await userEvent.click(row);
  await waitFor(() => expect(editable()).not.toBeNull(), { timeout: 10_000 });
  await userEvent.click(editable()!);
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
}

const linkButton = () =>
  document.querySelector<HTMLElement>(
    '.ed-inspector [aria-label="Link Body"]',
  )!;

it('adds, edits and removes a URL link from the field toolbar', async () => {
  const store = mount();
  await selectAllInInspector();
  expect(linkButton().getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(linkButton());
  const url = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>(
      '.ed-link-popup input[type="url"]',
    );
    expect(el).not.toBeNull();
    return el!;
  });
  await userEvent.click(url);
  await userEvent.keyboard('https://createcms.dev');
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(editable()!.querySelector('a')).not.toBeNull());
  await waitFor(
    () =>
      expect(linkMarks(store.body())[0]?.attrs?.link).toEqual({
        kind: 'external',
        url: 'https://createcms.dev',
      }),
    { timeout: 10_000 },
  );
  await waitFor(() =>
    expect(linkButton().getAttribute('aria-pressed')).toBe('true'),
  );

  await userEvent.click(linkButton());
  await waitFor(() =>
    expect(
      document.querySelector<HTMLInputElement>(
        '.ed-link-popup input[type="url"]',
      )?.value,
    ).toBe('https://createcms.dev'),
  );
  const remove = [
    ...document.querySelectorAll<HTMLElement>('.ed-link-popup button'),
  ].find((b) => b.textContent === 'Remove link')!;
  await userEvent.click(remove);
  await waitFor(() => expect(editable()!.querySelector('a')).toBeNull());
});

it('refuses an unsafe URL and says why', async () => {
  mount();
  await selectAllInInspector();
  await userEvent.click(linkButton());
  const url = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>(
      '.ed-link-popup input[type="url"]',
    );
    expect(el).not.toBeNull();
    return el!;
  });
  await userEvent.click(url);
  await userEvent.keyboard('javascript:alert(1)');
  await userEvent.keyboard('{Enter}');
  await waitFor(() =>
    expect(
      document.querySelector('.ed-link-popup .ed-error')?.textContent,
    ).toMatch(/http/),
  );
  expect(editable()!.querySelector('a')).toBeNull();
});

it('links a page of the collection the editor knows', async () => {
  const store = mount(true);
  await selectAllInInspector();
  await userEvent.click(linkButton());
  const page = await waitFor(() => {
    const el = [
      ...document.querySelectorAll<HTMLElement>('.ed-link-popup button'),
    ].find((b) => b.textContent?.trim() === 'Page');
    expect(el).toBeDefined();
    return el!;
  });
  await userEvent.click(page);
  await userEvent.click(
    [...document.querySelectorAll<HTMLElement>('.ed-link-popup button')].find(
      (b) => b.textContent?.startsWith('Pick About'),
    )!,
  );
  await userEvent.click(
    [...document.querySelectorAll<HTMLElement>('.ed-link-popup button')].find(
      (b) => b.textContent === 'Apply link',
    )!,
  );
  await waitFor(
    () =>
      expect(linkMarks(store.body())[0]?.attrs?.link).toEqual({
        kind: 'internal',
        collection: 'pages',
        rootId: 'about',
      }),
    { timeout: 10_000 },
  );
});

function clickAt(doc: Document, x: number, y: number) {
  const target = doc.elementFromPoint(x, y)!;
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new PointerEvent('pointerup', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));
  });
}

it('adds a link while editing text in place on the canvas', async () => {
  const store = mount();
  let doc: Document | null = null;
  await waitFor(
    () => {
      doc =
        [...document.querySelectorAll('iframe')]
          .map((frame) => frame.contentDocument)
          .find((d) => d?.querySelector('[data-editor-field="body"]')) ?? null;
      expect(doc).not.toBeNull();
    },
    { timeout: 10_000 },
  );
  const field = doc!.querySelector<HTMLElement>('[data-editor-field="body"]')!;
  for (let i = 0; i < 2; i++) {
    const box = field.getBoundingClientRect();
    clickAt(doc!, box.left + 20, box.top + box.height / 2);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await waitFor(() =>
    expect(doc!.activeElement?.getAttribute('contenteditable')).toBe('true'),
  );
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
  const link = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(
      '[data-slot="editor-block-toolbar"] [aria-label="Link"]',
    );
    expect(el).not.toBeNull();
    return el!;
  });
  await userEvent.click(link);
  const url = await waitFor(() => {
    const el = document.querySelector<HTMLInputElement>(
      '.ed-link-popup input[type="url"]',
    );
    expect(el).not.toBeNull();
    return el!;
  });
  await userEvent.click(url);
  await userEvent.keyboard('https://example.com');
  await userEvent.keyboard('{Enter}');
  await waitFor(
    () =>
      expect(linkMarks(store.body())[0]?.attrs?.link).toEqual({
        kind: 'external',
        url: 'https://example.com',
      }),
    { timeout: 10_000 },
  );
});
