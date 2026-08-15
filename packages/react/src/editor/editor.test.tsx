import type { AnyCollectionDefinition } from '@createcms/schema';

// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Canvas } from './canvas/index';
import { Editor, useEditorContext } from './index';

afterEach(cleanup);

const schema: AnyCollectionDefinition = {
  label: 'Pages',
  root: { properties: {} },
};

function Probe() {
  const { schema: fromContext } = useEditorContext('Probe');
  return <span data-testid="probe">{fromContext.label}</span>;
}

describe('Editor.Root', () => {
  it('provides the schema to parts below it', () => {
    const { getByTestId } = render(
      <Editor.Root schema={schema}>
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
});

describe('Canvas.Root shares the editor context', () => {
  it('renders inside Editor.Root with the presence marker attribute', () => {
    const { getByTestId } = render(
      <Editor.Root schema={schema}>
        <Canvas.Root data-testid="c" />
      </Editor.Root>,
    );
    const el = getByTestId('c');
    expect(el.getAttribute('data-editor-canvas')).toBe('');
  });

  it('throws a precise error when used outside Editor.Root', () => {
    expect(() => render(<Canvas.Root />)).toThrow(
      'Canvas.Root must be used within an Editor.Root component.',
    );
  });
});

describe('namespace shape', () => {
  it('Editor exposes exactly Root', () => {
    expect(Object.keys(Editor)).toEqual(['Root']);
  });

  it('Canvas exposes exactly Root', () => {
    expect(Object.keys(Canvas)).toEqual(['Root']);
  });
});
