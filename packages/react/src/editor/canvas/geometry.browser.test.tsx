import { act, cleanup, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { Canvas } from './index';
import { canvasBlocks } from './test/fixtures';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

type Props = {
  props: { text: string };
  edit: EditProps;
  children?: React.ReactNode;
};

function mountWith(
  heading: (props: Props) => React.ReactNode,
  style?: React.CSSProperties,
) {
  const utils = renderCanvas(
    <Canvas.Overlay>
      <Canvas.SelectionRing />
    </Canvas.Overlay>,
    {
      components: { ...canvasBlocks, heading } as unknown as CanvasComponents,
      style,
    },
  );
  act(() => utils.store.select('h1'));
  return utils;
}

const ring = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-editor-selection-ring]');

const close = (a: DOMRect, b: DOMRect) =>
  Math.abs(a.x - b.x) <= 1 &&
  Math.abs(a.y - b.y) <= 1 &&
  Math.abs(a.width - b.width) <= 1 &&
  Math.abs(a.height - b.height) <= 1;

describe('ring geometry', () => {
  it('display: contents takes the box of its children', async () => {
    const { host } = mountWith(({ edit, props }) => (
      <div {...edit.block} style={{ display: 'contents' }}>
        <p data-testid="inner" style={{ margin: 0, width: 120, height: 30 }}>
          {props.text}
        </p>
      </div>
    ));
    const inner = host.querySelector('[data-testid="inner"]')!;
    await waitFor(() => {
      expect(ring(host)).not.toBeNull();
      expect(
        close(
          ring(host)!.getBoundingClientRect(),
          inner.getBoundingClientRect(),
        ),
      ).toBe(true);
    });
  });

  it('an overflow ancestor clips the ring and flags the cut edge', async () => {
    const { host } = mountWith(({ edit, props }) => (
      <div style={{ overflow: 'hidden', height: 50 }} data-testid="clip">
        <div {...edit.block} style={{ height: 100 }}>
          {props.text}
        </div>
      </div>
    ));
    await waitFor(() => {
      const el = ring(host);
      expect(el).not.toBeNull();
      expect(el!.getBoundingClientRect().height).toBeCloseTo(50, 0);
      expect(el!.hasAttribute('data-clamped-bottom')).toBe(true);
      expect(el!.hasAttribute('data-clamped-top')).toBe(false);
    });
  });

  it('a rotated block gets its axis-aligned hull', async () => {
    const { host } = mountWith(({ edit, props }) => (
      <div
        {...edit.block}
        style={{
          width: 100,
          height: 40,
          margin: 40,
          transform: 'rotate(30deg)',
        }}
      >
        {props.text}
      </div>
    ));
    const block = host.querySelector('[data-editor-block="h1"]')!;
    await waitFor(() => {
      expect(
        close(
          ring(host)!.getBoundingClientRect(),
          block.getBoundingClientRect(),
        ),
      ).toBe(true);
    });
  });

  it('a sticky block keeps its ring while the canvas scrolls', async () => {
    const { host } = mountWith(
      ({ edit, props }) => (
        <div
          {...edit.block}
          style={{
            position: 'sticky',
            top: 0,
            height: 30,
            background: 'white',
          }}
        >
          {props.text}
        </div>
      ),
      { height: 120 },
    );
    const spacer = host.ownerDocument.createElement('div');
    spacer.style.height = '600px';
    host.append(spacer);
    const block = host.querySelector('[data-editor-block="h1"]')!;
    await waitFor(() => expect(ring(host)).not.toBeNull());
    host.scrollTop = 200;
    expect(host.scrollTop).toBeGreaterThan(0);
    await waitFor(() => {
      expect(
        close(
          ring(host)!.getBoundingClientRect(),
          block.getBoundingClientRect(),
        ),
      ).toBe(true);
    });
  });

  it('a ring stays on its block when a positioned canvas scrolls', async () => {
    const { host } = mountWith(
      ({ edit, props }) => (
        <div {...edit.block} style={{ height: 30, marginTop: 150 }}>
          {props.text}
        </div>
      ),
      { height: 120 },
    );
    const spacer = host.ownerDocument.createElement('div');
    spacer.style.height = '600px';
    host.append(spacer);
    const block = host.querySelector('[data-editor-block="h1"]')!;
    await waitFor(() => expect(ring(host)).not.toBeNull());
    host.scrollTop = 100;
    expect(host.scrollTop).toBeGreaterThan(90);
    await waitFor(() => {
      expect(
        close(
          ring(host)!.getBoundingClientRect(),
          block.getBoundingClientRect(),
        ),
      ).toBe(true);
    });
  });
});
