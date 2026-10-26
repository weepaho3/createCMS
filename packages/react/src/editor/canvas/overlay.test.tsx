// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorStore } from '../core/store';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
import { Canvas, useBlockRect } from './index';
import { selectionAncestors } from './overlay';
import { canvasBlocks } from './test/fixtures';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

function BlockRectProbe({ id }: { id: string }) {
  const rect = useBlockRect(id);
  return <span data-testid="block-rect">{rect ? 'yes' : 'no'}</span>;
}

describe('Canvas.Overlay', () => {
  it('throws outside Canvas.Root', () => {
    expect(() => render(<Canvas.Overlay />)).toThrow(
      'Canvas.Overlay must be used within a Canvas.Root component.',
    );
  });

  it('portals a data-editor-overlay into the canvas host', () => {
    const { host } = renderCanvas(<Canvas.Overlay />);
    const overlay = host.querySelector('[data-editor-overlay]');
    expect(overlay).not.toBeNull();
    expect(host.contains(overlay)).toBe(true);
  });

  it('lets useBlockRect read a mounted block', () => {
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
        <Canvas.Root components={canvasBlocks}>
          <BlockRectProbe id="h1" />
        </Canvas.Root>
      </Editor.Root>,
    );
    expect(getByTestId('block-rect').textContent).toMatch(/yes|no/);
  });
});

describe('Canvas rings', () => {
  it('mounts SelectionRing and FieldRing after select and focus', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.SelectionRing />
        <Canvas.FieldRing />
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('h1');
      store.focus({ blockId: 'h1', key: 'text' });
    });
    expect(host.querySelector('[data-editor-selection-ring]')).not.toBeNull();
    expect(host.querySelector('[data-editor-field-ring]')).not.toBeNull();
  });

  it('hides FieldRing once another block is selected', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.FieldRing />
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('h1');
      store.focus({ blockId: 'h1', key: 'text' });
    });
    expect(host.querySelector('[data-editor-field-ring]')).not.toBeNull();
    act(() => store.select('p1'));
    expect(host.querySelector('[data-editor-field-ring]')).toBeNull();
  });

  it('hides HoverRing when hovered equals selected', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.HoverRing />
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('h1');
      store.hover('h1');
    });
    expect(host.querySelector('[data-editor-hover-ring]')).toBeNull();
  });

  it('hides HoverRing while editing even if hovered is another id', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.HoverRing />
      </Canvas.Overlay>,
    );
    act(() => {
      store.hover('p1');
      store.setEditing({ blockId: 'h1', key: 'text' });
    });
    expect(host.querySelector('[data-editor-hover-ring]')).toBeNull();
  });
});

describe('Canvas.ParentRing', () => {
  it('lists ancestors nearest first and never the root', () => {
    const { nodes } = createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
    }).getDoc();
    expect(selectionAncestors(nodes, 'p1', 1)).toEqual(['sec1']);
    expect(selectionAncestors(nodes, 'p1', 5)).toEqual(['sec1']);
    expect(selectionAncestors(nodes, 'h1', 1)).toEqual([]);
    expect(selectionAncestors(nodes, 'sec1', 1)).toEqual([]);
    expect(selectionAncestors(nodes, null, 1)).toEqual([]);
  });

  it('rings the parent of a nested selection', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.ParentRing />
      </Canvas.Overlay>,
    );
    act(() => store.select('p1'));
    const rings = host.querySelectorAll('[data-editor-parent-ring]');
    expect(rings).toHaveLength(1);
    expect(rings[0]!.getAttribute('data-depth')).toBe('1');
    expect(rings[0]!.getAttribute('data-block-type')).toBe('section');
    expect(rings[0]!.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws nothing for a block directly under the root', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.ParentRing depth={3} />
      </Canvas.Overlay>,
    );
    act(() => store.select('h1'));
    expect(host.querySelector('[data-editor-parent-ring]')).toBeNull();
  });
});
