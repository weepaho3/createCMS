// @vitest-environment happy-dom
import * as React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Editor } from './index';
import { makeTree, storeSchema } from './store/fixtures';

const ui = (
  <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
    <Editor.Form blockId="root_1" />
  </Editor.Root>
);

function isHydrationMessage(value: unknown): boolean {
  const text = String(value);
  return /hydrat/i.test(text) || /did not match/i.test(text);
}

describe('SSR hydration', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('Editor.Root + Editor.Form hydrate without a mismatch', () => {
    const html = renderToString(ui);
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('Title');

    const container = document.createElement('div');
    document.body.appendChild(container);
    container.innerHTML = html;

    const recoverable: unknown[] = [];
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });
    const root = hydrateRoot(container, ui, {
      onRecoverableError(err) {
        recoverable.push(err);
      },
    });
    // layout effects (describedBy registration) run here; they must not count as a mismatch
    expect(recoverable.filter(isHydrationMessage)).toEqual([]);
    expect(errors.flat().filter(isHydrationMessage)).toEqual([]);
    expect(container.querySelector('label')?.textContent).toBe('Title');
    root.unmount();
    spy.mockRestore();
  });
});
