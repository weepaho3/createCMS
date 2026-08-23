// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Canvas } from './canvas/index';
import { canvasBlocks } from './canvas/test/fixtures';
import { Editor, useEditorContext } from './index';
import { makeTree, storeSchema } from './store/fixtures';

afterEach(cleanup);

function Probe() {
  const { schema: fromContext } = useEditorContext('Probe');
  return <span data-testid="probe">{fromContext.label}</span>;
}

function StoreProbe() {
  const { store, userId } = useEditorContext('StoreProbe');
  return (
    <span data-testid="store-probe">
      {store.getState().rootId}/{userId}
    </span>
  );
}

describe('Editor.Root', () => {
  it('provides the schema to parts below it', () => {
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Probe />
      </Editor.Root>,
    );
    expect(getByTestId('probe').textContent).toBe('Pages');
  });

  it('throws a precise error when a part is used outside Editor.Root', () => {
    expect(() => render(<Probe />)).toThrow(
      'Probe must be used within an Editor.Root component.',
    );
  });

  it('provides the store and the local user to parts below it', () => {
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe />
      </Editor.Root>,
    );
    expect(getByTestId('store-probe').textContent).toBe('root_1/local');
  });
});

describe('Canvas.Root shares the editor context', () => {
  it('renders inside Editor.Root with the presence marker attribute', () => {
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Canvas.Root data-testid="c" components={canvasBlocks} />
      </Editor.Root>,
    );
    const el = getByTestId('c');
    expect(el.getAttribute('data-editor-canvas')).toBe('');
  });

  it('throws a precise error when used outside Editor.Root', () => {
    expect(() => render(<Canvas.Root components={{}} />)).toThrow(
      'Canvas.Root must be used within an Editor.Root component.',
    );
  });
});

describe('namespace shape', () => {
  it('Editor exposes exactly Root, the field parts and the structure parts', () => {
    expect(Object.keys(Editor)).toEqual([
      'Root',
      'Field',
      'FieldLabel',
      'FieldControl',
      'FieldDescription',
      'FieldError',
      'Form',
      'Preview',
      'FramePreview',
      'OutlineItem',
      'AddBlock',
    ]);
  });

  it('Canvas exposes exactly Provider, Root, Overlay, the rings, BlockToolbar and InsertButton', () => {
    expect(Object.keys(Canvas)).toEqual([
      'Provider',
      'Root',
      'Overlay',
      'SelectionRing',
      'HoverRing',
      'FieldRing',
      'BlockToolbar',
      'InsertButton',
      'DragHandle',
      'PaletteItem',
      'DropIndicator',
      'DragPreview',
      'InlineText',
    ]);
  });
});

describe('Canvas.Overlay', () => {
  it('throws a precise error when used outside Canvas.Root', () => {
    expect(() => render(<Canvas.Overlay />)).toThrow(
      'Canvas.Overlay must be used within a Canvas.Root component.',
    );
  });
});
