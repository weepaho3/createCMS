// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../store';

import { Editor, useEditorContext } from '../index';
import { makeTree, storeSchema } from '../store/fixtures';
import { Canvas } from './index';
import { canvasBlocks } from './test/fixtures';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

type StoreProbeBag = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: StoreProbeBag }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

describe('Canvas.Provider', () => {
  it('palette item outside Canvas.Root renders enabled and click-inserts into the canvas', () => {
    const probe: StoreProbeBag = { store: null };
    const utils = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Canvas.Provider>
          <aside>
            <Canvas.PaletteItem type="paragraph">Add</Canvas.PaletteItem>
          </aside>
          <Canvas.Root data-testid="canvas" components={canvasBlocks} />
        </Canvas.Provider>
      </Editor.Root>,
    );
    const store = probe.store!;
    const host = utils.getByTestId('canvas');
    const button = utils.container.querySelector(
      'aside [data-editor-palette-item]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
    expect(host.contains(button)).toBe(false);
    const before = store.getState().nodes.root_1!.childIds.length;
    fireEvent.click(button);
    expect(store.getState().nodes.root_1!.childIds.length).toBe(before + 1);
  });

  it('palette item renders under Canvas.Provider without any Canvas.Root', () => {
    const utils = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Canvas.Provider>
          <Canvas.PaletteItem type="paragraph">Add</Canvas.PaletteItem>
        </Canvas.Provider>
      </Editor.Root>,
    );
    const button = utils.container.querySelector(
      '[data-editor-palette-item]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.disabled).toBe(false);
  });

  it('palette item without Provider and without Root throws', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.PaletteItem type="paragraph" />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.PaletteItem must be used within a Canvas.Provider or Canvas.Root component.',
    );
  });

  it('Canvas.Root without a Provider still provides the session to its children', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="paragraph">Add</Canvas.PaletteItem>
      </Canvas.Overlay>,
    );
    const before = store.getState().nodes.root_1!.childIds.length;
    const button = host.querySelector('[data-editor-palette-item]')!;
    fireEvent.click(button);
    expect(store.getState().nodes.root_1!.childIds.length).toBe(before + 1);
  });
});
