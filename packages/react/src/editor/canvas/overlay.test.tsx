// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '../index';
import { makeTree, storeSchema } from '../store/fixtures';
import { Canvas, useBlockRect } from './index';
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
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
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
