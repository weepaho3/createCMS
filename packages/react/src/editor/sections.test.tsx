// @vitest-environment happy-dom
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorDocument } from './core/document';
import type { RenderBlockProps } from './render';

import { Canvas, createSectionRefBlock } from './canvas';
import { defineEditorSchema } from './core/schema';
import {
  createSectionResolver,
  REF_TYPE,
  sectionsPlugin,
} from './core/sections';
import { createEditorStore } from './core/store';
import { Editor, useSectionOverrides } from './index';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Page', fields: {}, slots: { children: {} } },
  components: {
    heading: {
      label: 'Heading',
      fields: {
        text: { type: 'text', label: 'Text' },
        level: { type: 'number', label: 'Level' },
      },
      exposedProps: ['text'],
    },
  },
});

const header: EditorDocument = {
  schemaVersion: 1,
  root: {
    id: 'r',
    type: 'root',
    props: {},
    slots: {
      children: [
        { id: 'hd', type: 'heading', props: { text: 'Welcome', level: 1 } },
      ],
    },
  },
};

const page = (): EditorDocument => ({
  schemaVersion: 1,
  root: {
    id: 'page',
    type: 'root',
    props: {},
    slots: {
      children: [
        {
          id: 'sec',
          type: REF_TYPE,
          props: {
            ref: { collection: 'sections', id: 'header' },
            overrides: { hd: { text: 'Hi' } },
          },
        },
      ],
    },
  },
});

const resolver = createSectionResolver({
  resolveReference: async () => header,
  schema,
});

function Heading({ props, edit }: RenderBlockProps) {
  return <h1 {...edit.block}>{String(props.text)}</h1>;
}

const makeStore = () =>
  createEditorStore({
    schema,
    initialValue: page(),
    plugins: [sectionsPlugin({ resolver })],
  });

describe('$ref sections in the canvas', () => {
  it('renders the section read-only with its overrides', async () => {
    const store = makeStore();
    const components = { heading: Heading };
    const { container } = render(
      <Editor.Root store={store}>
        <Canvas.Root
          components={{
            ...components,
            [REF_TYPE]: createSectionRefBlock({ resolver, components }),
          }}
        />
      </Editor.Root>,
    );
    const block = container.querySelector<HTMLElement>(
      '[data-editor-block="sec"]',
    )!;
    expect(block.getAttribute('data-kind')).toBe('ref');
    await waitFor(() => expect(block.textContent).toBe('Hi'));
    expect(block.querySelector('[data-editor-readonly]')).not.toBeNull();
  });

  it('useSectionOverrides lists only exposed props and writes overrides', async () => {
    const store = makeStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Editor.Root store={store}>{children}</Editor.Root>
    );
    const { result } = renderHook(() => useSectionOverrides('sec', resolver), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toHaveLength(1));
    const [entry] = result.current;
    expect(entry).toMatchObject({
      nodeId: 'hd',
      key: 'text',
      value: 'Hi',
      overridden: true,
    });
    act(() => entry!.set(undefined));
    expect(store.getDoc().nodes.sec!.props.overrides).toEqual({});
    await waitFor(() =>
      expect(result.current[0]).toMatchObject({
        value: 'Welcome',
        overridden: false,
      }),
    );
  });
});
