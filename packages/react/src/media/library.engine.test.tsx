import { act, cleanup, render, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaAsset } from './core/types';

import { ASSET_DRAG_TYPE } from './core/drag';
import { createMediaStore } from './core/store';
import {
  Folder,
  Intake,
  Media,
  Preview,
  Selection,
  useIntakePaste,
  usePreview,
} from './index';
import { makeAsset, makeClient, makeUploadState } from './test-fixtures';

afterEach(cleanup);

const assets: MediaAsset[] = Array.from({ length: 7 }, (_, i) =>
  makeAsset({
    id: `a${i + 1}`,
    originalName: `photo-${i + 1}.png`,
    width: 1600,
    height: 1200,
    size: 2048,
  }),
);

function Library() {
  const preview = usePreview();
  const pasteRef = React.useRef<HTMLDivElement | null>(null);
  useIntakePaste(pasteRef);
  return (
    <div ref={pasteRef} tabIndex={-1} data-testid="paste">
      <nav aria-label="Folders">
        <Folder.Tree>
          {(row) => (
            <Folder.Item key={row.id} row={row}>
              {row.name}
            </Folder.Item>
          )}
        </Folder.Tree>
      </nav>
      <Media.Search />
      <Intake.Dropzone data-testid="dropzone">
        <Intake.Input />
      </Intake.Dropzone>
      <div style={{ height: 600, width: 500, overflow: 'auto' }}>
        <Media.Grid
          data-testid="grid"
          minCell={150}
          gap={10}
          onAction={(asset) => preview.open(asset.id)}
        >
          {(asset) => (
            <Media.Item key={asset.id} asset={asset}>
              <Selection.Checkbox />
              <Media.Thumbnail alt="" />
              {asset.originalName}
            </Media.Item>
          )}
        </Media.Grid>
      </div>
      <Preview.Root>
        <Preview.Stage>{() => <span>stage</span>}</Preview.Stage>
        <Preview.Close>Close</Preview.Close>
      </Preview.Root>
    </div>
  );
}

async function setup() {
  const upload = vi.fn(async (files: File[]) =>
    files.map((file) => ({ name: file.name })),
  );
  const client = makeClient({
    listAssets: vi.fn(async () => ({
      assets,
      total: assets.length,
      hasMore: false,
      nextCursor: null,
    })),
    useUploadAssets: vi.fn(() => makeUploadState({ upload: upload as never })),
  });
  const store = createMediaStore({ client, selection: 'multiple' });
  const view = render(
    <Media.Root client={client} store={store}>
      <Library />
    </Media.Root>,
  );
  await act(async () => {
    await store.dispatch({ type: 'init' });
  });
  await waitFor(() =>
    expect(view.container.querySelectorAll('[role="gridcell"]').length).toBe(7),
  );
  return { ...view, store, upload };
}

const grid = () => document.querySelector<HTMLElement>('[role="grid"]')!;
const cell = (id: string) =>
  document.querySelector<HTMLElement>(`[data-cell-id="${id}"]`)!;

function dataTransferWith(files: File[]): DataTransfer {
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  return transfer;
}

describe('media library in this engine', () => {
  it('has no axe violations', async () => {
    const { container } = await setup();
    const result = await axe.run(container, {
      // Headless parts are unstyled; contrast belongs to the registry styles.
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(
      result.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`,
      ),
    ).toEqual([]);
  });

  it('moves the focus with arrow keys and opens and closes the preview by keyboard', async () => {
    await setup();
    cell('a1').focus();
    cell('a1').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await waitFor(() => expect(document.activeElement).toBe(cell('a2')));
    cell('a2').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    const dialog = await waitFor(() => {
      const element = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(element).not.toBeNull();
      return element!;
    });
    expect(document.activeElement).toBe(dialog);
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    expect(document.activeElement).toBe(cell('a2'));
  });

  it('accepts dropped files and reports Files while dragging over', async () => {
    const { upload, getByTestId } = await setup();
    const zone = getByTestId('dropzone');
    const file = new File([new Uint8Array([1, 2, 3])], 'drop.png', {
      type: 'image/png',
    });
    const transfer = dataTransferWith([file]);
    let types: string[] = [];
    zone.addEventListener('dragover', (event) => {
      types = Array.from(event.dataTransfer?.types ?? []);
    });
    for (const type of ['dragenter', 'dragover', 'drop'] as const) {
      zone.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      );
    }
    expect(types).toContain('Files');
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][0].map((f: File) => f.name)).toEqual([
      'drop.png',
    ]);
  });

  it('uploads pasted screenshots under a dated name', async () => {
    const { upload, getByTestId } = await setup();
    const target = getByTestId('paste');
    const file = new File([new Uint8Array([1])], 'image.png', {
      type: 'image/png',
    });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: dataTransferWith([file]),
    });
    target.dispatchEvent(event);
    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(upload.mock.calls[0][0][0].name).toMatch(
      /^pasted-\d{4}-\d{2}-\d{2}-\d{6}\.png$/,
    );
  });

  it('selects by marquee from empty space', async () => {
    const { store } = await setup();
    const box = grid().getBoundingClientRect();
    const last = cell('a7').getBoundingClientRect();
    // Start right of the last cell (empty space in its row), drag up-left.
    const from = { x: box.right - 5, y: last.bottom - 5 };
    const to = { x: box.left + 5, y: last.top - 5 };
    const pointer = (type: string, at: { x: number; y: number }) =>
      new PointerEvent(type, {
        bubbles: true,
        clientX: at.x,
        clientY: at.y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
      });
    grid().dispatchEvent(pointer('pointerdown', from));
    window.dispatchEvent(
      pointer('pointermove', { x: from.x - 20, y: from.y - 20 }),
    );
    window.dispatchEvent(pointer('pointermove', to));
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    window.dispatchEvent(pointer('pointerup', to));
    await waitFor(() =>
      expect(store.getState().selection.selected).toContain('a7'),
    );
  });

  it('selects on a touch long press', async () => {
    const { store } = await setup();
    const box = cell('a3').getBoundingClientRect();
    cell('a3').dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: box.x + 10,
        clientY: box.y + 10,
        pointerId: 2,
        pointerType: 'touch',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 600));
    cell('a3').dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 2,
        pointerType: 'touch',
      }),
    );
    expect(store.getState().selection.selected).toEqual(['a3']);
  });

  it('drags assets out with the createcms MIME type', async () => {
    await setup();
    const transfer = new DataTransfer();
    cell('a1').dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
      }),
    );
    expect(Array.from(transfer.types)).toContain(ASSET_DRAG_TYPE);
    expect(JSON.parse(transfer.getData(ASSET_DRAG_TYPE))).toMatchObject({
      ids: ['a1'],
    });
  });
});
