import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorDocument, NodeData } from '../core/document';
import type { EditProps } from '../core/edit';
import type { EditorStore } from '../core/store';
import type { CanvasComponents } from './map';
import type { Measurer } from './measurer';

import { storeSchema } from '../core/store/fixtures';
import { Editor, useEditorContext } from '../index';
import { useCanvasContext } from './context';
import { Canvas } from './index';

afterEach(cleanup);

type Bag = { store: EditorStore | null; measurer: Measurer | null };

function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  bag.measurer = useCanvasContext('Probe').measurer;
  return null;
}

function Heading({
  props,
  edit,
}: {
  props: { text: string };
  edit: EditProps;
}) {
  return (
    <h2 {...edit.block} style={{ margin: 0, height: 20 }}>
      {props.text}
    </h2>
  );
}

function Picture({
  props,
  edit,
}: {
  props: { text: string };
  edit: EditProps;
}) {
  return (
    <div {...edit.block} data-picture={props.text} style={{ width: 100 }}>
      <img alt="" data-testid="img" style={{ display: 'block', width: 100 }} />
    </div>
  );
}

function docOf(count: number, extra: NodeData[] = []): EditorDocument {
  const children: NodeData[] = [...extra];
  for (let i = 0; i < count; i++) {
    children.push({
      id: `b${i}`,
      type: 'heading',
      props: { text: `B${i}`, level: 2 },
    });
  }
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: { title: 'x' },
      slots: { children },
    },
  };
}

function mount(doc: EditorDocument, components: CanvasComponents) {
  const bag: Bag = { store: null, measurer: null };
  const utils = render(
    <Editor.Root schema={storeSchema} defaultValue={doc}>
      <Canvas.Root
        data-testid="canvas"
        components={components}
        style={{
          position: 'relative',
          width: 300,
          height: 400,
          overflow: 'auto',
        }}
      >
        <Probe bag={bag} />
        <Canvas.Overlay>
          <Canvas.SelectionRing />
        </Canvas.Overlay>
      </Canvas.Root>
    </Editor.Root>,
  );
  return { ...utils, bag };
}

const ringMatches = (host: HTMLElement, id: string) => {
  const ring = host
    .querySelector('[data-editor-selection-ring]')!
    .getBoundingClientRect();
  const block = host
    .querySelector(`[data-editor-block="${id}"]`)!
    .getBoundingClientRect();
  return (
    Math.abs(ring.top - block.top) <= 1 &&
    Math.abs(ring.height - block.height) <= 1
  );
};

describe('measurer tracking', () => {
  it('with 1000 blocks and one selection only the tracked rects are measured', async () => {
    const { bag, getByTestId } = mount(docOf(1000), {
      heading: Heading,
    } as unknown as CanvasComponents);
    const host = getByTestId('canvas');
    act(() => bag.store!.select('b10'));
    await waitFor(() =>
      expect(host.querySelector('[data-editor-selection-ring]')).not.toBeNull(),
    );
    act(() => {
      bag.store!.update('b5', { text: 'Changed' });
    });
    host.style.width = '320px';
    await waitFor(() =>
      expect(bag.measurer!.stats().lastFlush).toBeGreaterThan(0),
    );
    expect(bag.measurer!.stats().tracked).toBeLessThanOrEqual(3);
    expect(bag.measurer!.stats().lastFlush).toBeLessThanOrEqual(3);
  });

  it('a ring follows a block whose image loads later within 100 ms or so', async () => {
    const { bag, getByTestId } = mount(
      docOf(0, [
        { id: 'pic', type: 'heading', props: { text: 'pic', level: 2 } },
      ]),
      { heading: Picture } as unknown as CanvasComponents,
    );
    const host = getByTestId('canvas');
    act(() => bag.store!.select('pic'));
    await waitFor(() => expect(ringMatches(host, 'pic')).toBe(true));
    const img = host.querySelector<HTMLImageElement>('[data-testid="img"]')!;
    // A tall inline SVG stands in for a loading image.
    img.src =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="160"/>',
      );
    await waitFor(() => {
      expect(
        host.querySelector('[data-editor-block="pic"]')!.getBoundingClientRect()
          .height,
      ).toBeGreaterThan(100);
      expect(ringMatches(host, 'pic')).toBe(true);
    });
  });

  it('a ring follows a block moved by a CSS transition (poll)', async () => {
    const { bag, getByTestId } = mount(docOf(3), {
      heading: Heading,
    } as unknown as CanvasComponents);
    const host = getByTestId('canvas');
    act(() => bag.store!.select('b2'));
    await waitFor(() => expect(ringMatches(host, 'b2')).toBe(true));
    const first = host.querySelector<HTMLElement>('[data-editor-block="b0"]')!;
    first.style.transition = 'height 200ms linear';
    await new Promise((resolve) => requestAnimationFrame(resolve));
    first.style.height = '80px';
    await new Promise((resolve) => setTimeout(resolve, 400));
    await waitFor(() => expect(ringMatches(host, 'b2')).toBe(true), {
      timeout: 500,
    });
  });
});
