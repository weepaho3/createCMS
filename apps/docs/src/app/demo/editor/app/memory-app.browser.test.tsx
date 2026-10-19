import '@/app/global.css';
import { createMemoryAdapter } from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/editor-app';

import { components, home, schema } from './memory-app';

afterEach(async () => {
  cleanup();
  await page.viewport(1280, 800);
});

function mount(mode: 'canvas' | 'form' = 'canvas') {
  const adapter = createMemoryAdapter({ home });
  const utils = render(
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <EditorApp
        adapter={adapter}
        documentId="home"
        baseVersion={adapter.version('home')}
        schema={schema}
        components={components}
        mode={mode}
      />
    </div>,
  );
  return { ...utils, adapter };
}

/** axe findings of impact serious or critical, as `rule: targets` lines. */
async function seriousViolations(context: Element | Document = document) {
  // Base UI's drawer focus guards are hidden tab sentinels; WebKit gets
  // them with role=button and no name, which is the library's markup.
  const results = await axe.run(
    { include: [context], exclude: [['[data-base-ui-focus-guard]']] },
    { rules: { region: { enabled: false } } },
  );
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
}

const ready = () =>
  waitFor(
    () =>
      expect(
        document.querySelector(
          '[data-slot="editor-outline"] [role="treeitem"]',
        ),
      ).not.toBeNull(),
    { timeout: 10_000 },
  );

const treeItem = (label: string) =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="editor-outline"] [role="treeitem"]',
    ),
  ].find((el) => el.textContent?.includes(label));

/** Matches in the page and in the canvas frame (the device frame surface). */
function inAllDocuments<T extends Element>(selector: string): T[] {
  const frames = [...document.querySelectorAll('iframe')].flatMap((frame) =>
    frame.contentDocument ? [frame.contentDocument] : [],
  );
  return [document, ...frames].flatMap((doc) => [
    ...doc.querySelectorAll<T>(selector),
  ]);
}

const focusedLabel = () =>
  (document.activeElement as HTMLElement | null)?.textContent;

describe('editor-app on the memory adapter', () => {
  it('has no serious or critical axe violations on desktop', async () => {
    mount();
    await ready();
    expect(await seriousViolations()).toEqual([]);
  });

  it('has no serious or critical axe violations with a block selected', async () => {
    mount();
    await ready();
    await userEvent.click(treeItem('Heading')!);
    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="editor-inspector"] input'),
      ).not.toBeNull(),
    );
    expect(await seriousViolations()).toEqual([]);
  });

  it('navigates the outline as an APG tree', async () => {
    mount();
    await ready();
    treeItem('Heading')!.focus();
    await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(focusedLabel()).toContain('Section'));
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(focusedLabel()).toContain('Paragraph'));
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(focusedLabel()).toContain('Section'));
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(focusedLabel()).toContain('Heading'));
  });

  it('opens the command palette with Mod+K and runs a command by keyboard', async () => {
    const { adapter } = mount();
    await ready();
    await userEvent.click(treeItem('Heading')!);
    await userEvent.keyboard('{ControlOrMeta>}k{/ControlOrMeta}');
    const input = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>(
        '[role="dialog"] input',
      );
      expect(el).not.toBeNull();
      return el!;
    });
    expect(document.activeElement).toBe(input);
    expect(
      await seriousViolations(document.querySelector('[role="dialog"]')!),
    ).toEqual([]);
    await userEvent.keyboard('duplicate');
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(
        document.querySelectorAll(
          '[data-slot="editor-outline"] [role="treeitem"]',
        ),
      ).toHaveLength(4),
    );
    // Autosave writes the duplicate through the adapter.
    await waitFor(
      () => expect(adapter.get('home')?.root.slots?.children).toHaveLength(3),
      { timeout: 10_000 },
    );
  });

  it('moves a block without dragging: block toolbar by keyboard', async () => {
    mount();
    await ready();
    await userEvent.click(treeItem('Heading')!);
    const moveDown = await waitFor(() => {
      const el = inAllDocuments<HTMLButtonElement>(
        '[data-slot="editor-block-toolbar"] button',
      ).find((button) => button.textContent?.includes('Move down'));
      expect(el).toBeDefined();
      return el!;
    });
    moveDown.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => {
      const labels = [
        ...document.querySelectorAll(
          '[data-slot="editor-outline"] [role="treeitem"]',
        ),
      ].map((el) => el.textContent);
      expect(labels[0]).toContain('Section');
    });
  });

  it('keeps every structure action reachable on a phone, without axe violations', async () => {
    await page.viewport(390, 844);
    mount();
    const bar = await waitFor(
      () => {
        const el = document.querySelector('[data-slot="editor-bottom-bar"]');
        expect(el).not.toBeNull();
        return el!;
      },
      { timeout: 10_000 },
    );
    expect(await seriousViolations()).toEqual([]);
    const outline = [...bar.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Outline'),
    )!;
    await userEvent.click(outline);
    await waitFor(() =>
      expect(
        document.querySelector('[role="dialog"] [role="treeitem"]'),
      ).not.toBeNull(),
    );
    expect(await seriousViolations()).toEqual([]);
  });

  it('reaches nested blocks in form mode through the content list and the path', async () => {
    mount('form');
    await ready();
    const surface = () =>
      document.querySelector<HTMLElement>('[data-slot="editor-form-surface"]')!;
    const heading = () => surface().querySelector('h1')!.textContent;
    expect(heading()).toBe('Page');
    const row = (label: string) =>
      [
        ...surface().querySelectorAll<HTMLElement>(
          '[data-slot="editor-form-child"]',
        ),
      ].find((el) => el.textContent?.startsWith(label))!;
    await userEvent.click(row('Section'));
    await waitFor(() => expect(heading()).toBe('Section'));
    expect(row('Paragraph')).toBeDefined();
    await userEvent.click(row('Paragraph'));
    await waitFor(() => expect(heading()).toBe('Paragraph'));
    const path = surface().querySelector(
      '[data-slot="editor-form-breadcrumb"]',
    )!;
    expect(path.textContent).toContain('Page');
    expect(path.textContent).toContain('Section');
    await userEvent.click(
      [...path.querySelectorAll('button')].find(
        (b) => b.textContent === 'Page',
      )!,
    );
    await waitFor(() => expect(heading()).toBe('Page'));
    expect(await seriousViolations(surface())).toEqual([]);
  });
});
