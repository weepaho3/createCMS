import '@/app/global.css';
import type { EditorDocument } from '@createcms/react/editor/core';

import { createMemoryAdapter } from '@createcms/react/editor/core';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { EditorApp } from '@/components/editor-app';

import { components, home, schema } from './memory-app';

// Screenshots of the registry chrome around a selected block, a drag and
// the insert button, in light and dark. References come from the pinned
// CI container only (vitest.visual.config.ts).

const doc: EditorDocument = {
  ...home,
  root: {
    ...home.root,
    slots: {
      children: [
        ...(home.root.slots?.children ?? []),
        {
          id: 'empty',
          type: 'section',
          props: { tone: 'plain' },
          slots: { children: [] },
        },
        // Content below the targets keeps them away from the frame's lower
        // edge, where a drag scrolls the canvas.
        ...Array.from({ length: 12 }, (_, i) => ({
          id: `filler${i}`,
          type: 'heading',
          props: { text: `Filler ${i + 1}` },
        })),
      ],
    },
  },
};

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});

function inAllDocuments<T extends Element>(selector: string): T[] {
  const frames = [...document.querySelectorAll('iframe')].flatMap((frame) =>
    frame.contentDocument ? [frame.contentDocument] : [],
  );
  return [document, ...frames].flatMap((d) => [
    ...d.querySelectorAll<T>(selector),
  ]);
}

async function mount(theme: 'light' | 'dark') {
  if (theme === 'dark') document.documentElement.classList.add('dark');
  const adapter = createMemoryAdapter({ home: doc });
  render(
    <div style={{ height: 800, display: 'flex', flexDirection: 'column' }}>
      <EditorApp
        adapter={adapter}
        documentId="home"
        schema={schema}
        components={components}
      />
    </div>,
  );
  await waitFor(
    () =>
      expect(
        document.querySelector(
          '[data-slot="editor-outline"] [role="treeitem"]',
        ),
      ).not.toBeNull(),
    { timeout: 10_000 },
  );
  // Fonts and the frame's styles settle before the first picture.
  await document.fonts.ready;
}

/**
 * Resolves once the drop indicator and the canvas frame's scroll position
 * stayed the same for five frames: a drag can scroll and reflow the frame
 * for a moment, and a screenshot must not catch that.
 */
async function settled(selector: string) {
  const frame = document.querySelector('iframe')?.contentWindow ?? window;
  const key = () => {
    const el = inAllDocuments<HTMLElement>(selector)[0];
    const r = el?.getBoundingClientRect();
    return `${r?.x},${r?.y},${r?.width},${r?.height},${frame.scrollY}`;
  };
  let last = '';
  let same = 0;
  while (same < 5) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const next = key();
    same = next === last ? same + 1 : 0;
    last = next;
  }
}

const app = () =>
  page.elementLocator(document.querySelector('[data-slot="editor-app"]')!);

const treeItem = (label: string) =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '[data-slot="editor-outline"] [role="treeitem"]',
    ),
  ].find((el) => el.textContent?.includes(label))!;

describe.each(['light', 'dark'] as const)('editor chrome (%s)', (theme) => {
  it('selection ring, chip and block toolbar', async () => {
    await mount(theme);
    await userEvent.click(treeItem('Heading'));
    await waitFor(() =>
      expect(
        inAllDocuments('[data-slot="editor-block-toolbar"]'),
      ).not.toHaveLength(0),
    );
    await expect.element(app()).toMatchScreenshot(`selected-${theme}`);
  });

  it('drop line and drag preview while moving a block', async () => {
    await mount(theme);
    await userEvent.click(treeItem('Heading'));
    const handle = await waitFor(() => {
      const el = inAllDocuments<HTMLElement>('[data-editor-drag-handle]')[0];
      expect(el).toBeDefined();
      return el!;
    });
    const view = handle.ownerDocument.defaultView!;
    const box = handle.getBoundingClientRect();
    const target = inAllDocuments<HTMLElement>(
      '[data-editor-block="p1"]',
    )[0]!.getBoundingClientRect();
    const fire = (type: string, x: number, y: number) =>
      handle.dispatchEvent(
        new view.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          pointerId: 1,
          pointerType: 'mouse',
        }),
      );
    fire('pointerdown', box.x + 4, box.y + 4);
    fire('pointermove', box.x + 12, box.y + 12);
    fire(
      'pointermove',
      target.x + target.width / 2,
      target.y + target.height - 2,
    );
    await waitFor(() =>
      expect(inAllDocuments('[data-editor-drop-indicator]')).not.toHaveLength(
        0,
      ),
    );
    await expect.element(app()).toMatchScreenshot(`drag-line-${theme}`);
    const empty = inAllDocuments<HTMLElement>(
      '[data-editor-block="empty"]',
    )[0]!.getBoundingClientRect();
    fire('pointermove', empty.x + empty.width / 2, empty.y + empty.height / 2);
    await waitFor(() =>
      expect(
        inAllDocuments('[data-editor-drop-indicator][data-variant="box"]'),
      ).not.toHaveLength(0),
    );
    await settled('[data-editor-drop-indicator]');
    await expect.element(app()).toMatchScreenshot(`drag-box-${theme}`);
    handle.ownerDocument.dispatchEvent(
      new view.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fire('pointerup', empty.x, empty.y);
  });
});
