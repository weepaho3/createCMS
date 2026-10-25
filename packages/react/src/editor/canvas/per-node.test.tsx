// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { resetWarnings } from '../core/codes';
import { createEditorStore } from '../core/store';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
import { Canvas } from './index';

afterEach(cleanup);

function countingBlocks() {
  const renders: Record<string, number> = {};
  const bump = (id: string) => {
    renders[id] = (renders[id] ?? 0) + 1;
  };
  const Heading = ({
    id,
    props,
    edit,
  }: {
    id: string;
    props: { text?: string };
    edit: EditProps;
  }) => {
    bump(id);
    return <h2 {...edit.block}>{props.text}</h2>;
  };
  const Paragraph = ({
    id,
    props,
    edit,
  }: {
    id: string;
    props: { text?: string };
    edit: EditProps;
  }) => {
    bump(id);
    return <p {...edit.block}>{props.text}</p>;
  };
  const Section = ({
    id,
    edit,
    children,
  }: {
    id: string;
    edit: EditProps;
    children?: React.ReactNode;
  }) => {
    bump(id);
    return <section {...edit.block}>{children}</section>;
  };
  const components = {
    heading: Heading,
    paragraph: Paragraph,
    section: Section,
  } as unknown as CanvasComponents;
  return { renders, components };
}

function mount(
  components: CanvasComponents,
  extra?: Partial<React.ComponentProps<typeof Canvas.Root>>,
) {
  const store = createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
  });
  const utils = render(
    <Editor.Root store={store}>
      <Canvas.Root components={components} {...extra} />
    </Editor.Root>,
  );
  return { store, ...utils };
}

describe('per-node rendering', () => {
  it('an edit renders only the edited block', () => {
    const { renders, components } = countingBlocks();
    const { store } = mount(components);
    const before = { ...renders };
    act(() => {
      store.update('p1', { text: 'Changed' });
    });
    expect(renders.p1).toBe((before.p1 ?? 0) + 1);
    expect(renders.h1).toBe(before.h1);
    expect(renders.sec1).toBe(before.sec1);
  });

  it('a reorder re-renders no block', () => {
    const { renders, components } = countingBlocks();
    const { store, container } = mount(components);
    const before = { ...renders };
    act(() => {
      store.move('sec1', { parent: { id: 'root_1' }, index: 0 });
    });
    expect(renders).toEqual(before);
    expect(
      [...container.querySelectorAll('[data-editor-block]')].map((el) =>
        el.getAttribute('data-editor-block'),
      ),
    ).toEqual(['sec1', 'p1', 'h1']);
  });

  it('selection and hover re-render no block', () => {
    const { renders, components } = countingBlocks();
    const { store } = mount(components);
    const before = { ...renders };
    act(() => {
      store.select('h1');
      store.hover('p1');
    });
    expect(renders).toEqual(before);
  });

  it('an insert renders only the new block (the parent keeps its render)', () => {
    const { renders, components } = countingBlocks();
    const { store } = mount(components);
    const before = { ...renders };
    let id: string | null = null;
    act(() => {
      id = store.add('heading', { parent: { id: 'sec1' } });
    });
    expect(renders[id ?? '']).toBe(1);
    expect(renders.sec1).toBe(before.sec1);
  });
});

describe('error boundary', () => {
  function throwingBlocks() {
    const { components } = countingBlocks();
    const Paragraph = ({
      props,
      edit,
    }: {
      props: { text?: string };
      edit: EditProps;
    }) => {
      if (props.text === 'boom') throw new Error('boom');
      return <p {...edit.block}>{props.text}</p>;
    };
    return { ...components, paragraph: Paragraph } as CanvasComponents;
  }

  it('shows Canvas.BlockError for a throwing block, the rest keeps working, onError reports it', () => {
    resetWarnings();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = vi.fn();
    const store = createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
    });
    const { container } = render(
      <Editor.Root store={store} onError={onError}>
        <Canvas.Root components={throwingBlocks()} />
      </Editor.Root>,
    );
    act(() => {
      store.update('p1', { text: 'boom' });
    });
    const fallback = container.querySelector('[data-block-error]');
    expect(fallback?.getAttribute('data-editor-block')).toBe('p1');
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'render',
        nodeId: 'p1',
        type: 'paragraph',
      }),
    );
    act(() => {
      store.update('h1', { text: 'Still alive' });
    });
    expect(container.textContent).toContain('Still alive');
    act(() => {
      store.undo();
      store.undo();
    });
    expect(container.querySelector('[data-block-error]')).toBeNull();
    expect(container.textContent).toContain('World');
    vi.restoreAllMocks();
  });

  it('renderBlockError replaces the default fallback', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
    });
    store.update('p1', { text: 'boom' });
    const { getByTestId } = render(
      <Editor.Root store={store}>
        <Canvas.Root
          components={throwingBlocks()}
          renderBlockError={({ blockId }) => (
            <div data-testid="custom" data-editor-block={blockId} />
          )}
        />
      </Editor.Root>,
    );
    expect(getByTestId('custom').getAttribute('data-editor-block')).toBe('p1');
    vi.restoreAllMocks();
  });
});
