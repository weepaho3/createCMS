import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { labelPlacement } from './chrome';
import { Canvas } from './index';
import {
  canvasBlocks,
  columnStackBlocks,
  columnStackTree,
  insertStackSchema,
} from './test/fixtures';
import {
  dispatchPointer,
  rectOf,
  renderCanvas,
  waitForLayout,
} from './test/harness';

afterEach(cleanup);

describe('labelPlacement', () => {
  it('above when it fits, below short blocks, inside tall ones', () => {
    expect(labelPlacement({ y: 40, height: 100 }, 0)).toBe('above');
    expect(labelPlacement({ y: 10, height: 100 }, 0)).toBe('below');
    expect(labelPlacement({ y: 10, height: 400 }, 0)).toBe('inside');
    expect(labelPlacement({ y: 120, height: 100 }, 110)).toBe('below');
  });
});

describe('canvas chrome parts', () => {
  it('Canvas.Label flips and its breadcrumb selects and highlights ancestors', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.Label data-testid="label" />
      </Canvas.Overlay>,
    );
    await waitForLayout(host.querySelector('[data-editor-block="p1"]')!);
    act(() => store.select('h1'));
    const label = await waitFor(() => {
      const el = host.querySelector<HTMLElement>('[data-testid="label"]');
      expect(el).not.toBeNull();
      return el!;
    });
    // h1 sits at the very top: no room above.
    expect(label.getAttribute('data-placement')).toBe('below');
    act(() => store.select('p1'));
    await waitFor(() =>
      expect(
        host
          .querySelector('[data-testid="label"]')!
          .getAttribute('data-placement'),
      ).toBe('above'),
    );
    act(() =>
      host
        .querySelector<HTMLElement>('[data-testid="label"] > button')!
        .click(),
    );
    const crumbs = [
      ...host.querySelectorAll('[data-editor-label-breadcrumb] button'),
    ];
    expect(crumbs.map((button) => button.textContent)).toEqual([
      'Section',
      'the page',
    ]);
    fireEvent.pointerEnter(crumbs[0]!);
    expect(store.getEphemeral().hoverId).toBe('sec1');
    act(() => (crumbs[0] as HTMLElement).click());
    expect(store.getSession().selection).toEqual(['sec1']);
  });

  it('Canvas.InsertButton shows only after the pointer rested at a gap', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="cell">
          +
        </Canvas.InsertButton>
      </Canvas.Overlay>,
      {
        schema: insertStackSchema,
        tree: columnStackTree(),
        components: columnStackBlocks,
      },
    );
    const c1 = host.querySelector('[data-editor-block="c1"]')!;
    await waitForLayout(c1);
    store.hover('c2');
    const top = rectOf(c1);
    dispatchPointer(host, 'pointermove', {
      x: top.x + top.width / 2,
      y: top.y + 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(host.querySelector('[data-editor-insert-button]')).toBeNull();
    await waitFor(() =>
      expect(host.querySelector('[data-editor-insert-button]')).not.toBeNull(),
    );
  });

  it('Canvas.EmptySlot marks a drag over it and leaves once the slot fills', async () => {
    function Stack({
      edit,
      children,
    }: {
      edit: EditProps;
      children?: React.ReactNode;
    }) {
      return (
        <div {...edit.block} {...edit.slot?.children} style={{ width: 160 }}>
          {children}
          <Canvas.EmptySlot blockId="stack1" data-testid="empty" />
        </div>
      );
    }
    const tree = columnStackTree();
    tree.root.slots!.children![0]!.slots!.children = [];
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
      </Canvas.Overlay>,
      {
        schema: insertStackSchema,
        tree,
        components: { ...columnStackBlocks, stack: Stack } as CanvasComponents,
      },
    );
    const empty = await waitFor(() => {
      const el = host.querySelector<HTMLElement>('[data-testid="empty"]');
      expect(el).not.toBeNull();
      return el!;
    });
    expect(empty.getBoundingClientRect().height).toBeGreaterThanOrEqual(64);
    const palette = host.querySelector('[data-editor-palette-item]')!;
    const from = rectOf(palette);
    const to = rectOf(empty);
    dispatchPointer(palette, 'pointerdown', { x: from.x + 4, y: from.y + 4 });
    dispatchPointer(palette, 'pointermove', { x: from.x + 12, y: from.y + 4 });
    dispatchPointer(palette, 'pointermove', { x: to.x + 20, y: to.y + 20 });
    await waitFor(() =>
      expect(empty.hasAttribute('data-drag-over')).toBe(true),
    );
    dispatchPointer(palette, 'pointerup', { x: to.x + 20, y: to.y + 20 });
    expect(store.getDoc().nodes.stack1!.slots.children).toHaveLength(1);
    await waitFor(() =>
      expect(host.querySelector('[data-testid="empty"]')).toBeNull(),
    );
  });

  it('Canvas.SpacingOverlay draws padding and margin strips', async () => {
    function Padded({ edit }: { edit: EditProps }) {
      return (
        <div {...edit.block} style={{ padding: 10, margin: 6, height: 20 }} />
      );
    }
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.SpacingOverlay blockId="h1" />
      </Canvas.Overlay>,
      {
        components: {
          ...canvasBlocks,
          heading: Padded,
        } as unknown as CanvasComponents,
      },
    );
    await waitFor(() => {
      expect(host.querySelectorAll('[data-box="padding"]')).toHaveLength(4);
      expect(host.querySelectorAll('[data-box="margin"]')).toHaveLength(4);
    });
    const top = host.querySelector<HTMLElement>(
      '[data-box="padding"][data-side="top"]',
    )!;
    expect(top.getBoundingClientRect().height).toBeCloseTo(10, 0);
  });

  it('Canvas.BlockToolbar flags when it flips inside the block', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar side="top" data-testid="toolbar">
          <button type="button">x</button>
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
    );
    act(() => store.select('h1'));
    await waitFor(() => {
      expect(
        host
          .querySelector('[data-testid="toolbar"]')!
          .hasAttribute('data-flipped'),
      ).toBe(true);
    });
  });
});
