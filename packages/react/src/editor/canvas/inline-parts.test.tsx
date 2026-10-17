import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// @vitest-environment happy-dom
import type { EditorDocument } from '../core/document';

import { defineEditorSchema } from '../core/schema';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
import { Canvas } from './index';
import {
  EMPTY_FIELD_PLACEHOLDER,
  RICH_TEXT_INLINE_WARNING,
} from './inline-text';
import {
  canvasBlocks,
  nestedTextBlocks,
  nestedTextSchema,
  nestedTextTree,
} from './test/fixtures';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

const badgeSchema = defineEditorSchema({
  root: { label: 'Pages', fields: {}, slots: { children: {} } },
  components: {
    heading: {
      label: 'Heading',
      fields: {
        text: { type: 'text', label: 'Text' },
        level: { type: 'number', label: 'Level', defaultValue: 2 },
        badge: { type: 'text', label: 'Badge' },
      },
    },
  },
});

function badgeTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'h1',
            type: 'heading',
            props: { text: 'Hello', level: 1, badge: '' },
          },
        ],
      },
    },
  };
}

function inlineOverlay() {
  return (
    <Canvas.Overlay>
      <Canvas.InlineText />
    </Canvas.Overlay>
  );
}

describe('Canvas.InlineText', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
          <Canvas.InlineText />
        </Editor.Root>,
      ),
    ).toThrow('Canvas.InlineText must be used within a Canvas.Root component.');
  });

  it('click on heading text sets editing and mounts the glass', () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    act(() => {
      field!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(store.getState().selection.local?.editing).toEqual({
      blockId: 'h1',
      key: 'text',
    });
    expect(host.querySelector('[data-editor-inline-text]')).not.toBeNull();
  });

  it('click on a number field sets focus but not editing', () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const level = host.querySelector('[data-editor-field="level"]');
    expect(level).not.toBeNull();
    act(() => {
      level!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(store.getState().selection.local?.focus).toEqual({
      blockId: 'h1',
      key: 'level',
    });
    expect(store.getState().selection.local?.editing).toBeNull();
    expect(host.querySelector('[data-editor-inline-text]')).toBeNull();
  });

  it('select mode click does not set editing', () => {
    const { host, store } = renderCanvas(inlineOverlay(), {
      interactive: 'select',
    });
    const field = host.querySelector('[data-editor-field="text"]');
    act(() => {
      field!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(store.getState().selection.local?.editing).toBeNull();
  });

  it('nested same-key click targets the inner block', () => {
    const { host, store } = renderCanvas(inlineOverlay(), {
      schema: nestedTextSchema,
      tree: nestedTextTree(),
      components: nestedTextBlocks,
    });
    const inner = host.querySelector(
      '[data-editor-block="inner1"] [data-editor-field="text"]',
    );
    expect(inner).not.toBeNull();
    act(() => {
      inner!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(store.getState().selection.local?.editing?.blockId).toBe('inner1');
  });

  it('richText click selects the block and focuses the field without a session', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { host, store } = renderCanvas(inlineOverlay());
    const para = host.querySelector('[data-editor-block="p1"]');
    expect(para).not.toBeNull();
    act(() => {
      para!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const selection = store.getState().selection.local;
    expect(selection?.editing).toBeNull();
    expect(selection?.selected).toBe('p1');
    expect(selection?.focus).toEqual({ blockId: 'p1', key: 'text' });
    expect(host.querySelector('[data-editor-inline-text]')).toBeNull();
    expect(warn).toHaveBeenCalledWith(RICH_TEXT_INLINE_WARNING);
    warn.mockRestore();
  });

  it('two editors on one page keep lookup scoped', () => {
    const tree = makeDoc();
    const utils = render(
      <div style={{ display: 'flex' }}>
        <Editor.Root schema={storeSchema} defaultValue={tree}>
          <Canvas.Root
            data-testid="canvas-a"
            components={canvasBlocks}
            style={{ width: 400, height: 300 }}
          >
            <Canvas.Overlay>
              <Canvas.InlineText />
            </Canvas.Overlay>
          </Canvas.Root>
        </Editor.Root>
        <Editor.Root schema={storeSchema} defaultValue={tree}>
          <Canvas.Root
            data-testid="canvas-b"
            components={canvasBlocks}
            style={{ width: 400, height: 300 }}
          >
            <Canvas.Overlay>
              <Canvas.InlineText />
            </Canvas.Overlay>
          </Canvas.Root>
        </Editor.Root>
      </div>,
    );
    const hostB = utils.getByTestId('canvas-b');
    const field = hostB.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    act(() => {
      field!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const hostA = utils.getByTestId('canvas-a');
    expect(hostA.querySelector('[data-editor-inline-text]')).toBeNull();
    expect(hostB.querySelector('[data-editor-inline-text]')).not.toBeNull();
  });

  // happy-dom does not deliver contentEditable input; typing is covered
  // in inline-text.browser.test.tsx.

  it('empty badge field exists before click and commits without placeholder', () => {
    const { host, store } = renderCanvas(inlineOverlay(), {
      schema: badgeSchema,
      tree: badgeTree(),
    });
    const badge = host.querySelector('[data-editor-field="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe(EMPTY_FIELD_PLACEHOLDER);
    act(() => {
      badge!.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    expect(glass).not.toBeNull();
    act(() => {
      glass.textContent = '';
      glass.dispatchEvent(new Event('input', { bubbles: true }));
      glass.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });
    expect(store.getState().nodes.h1!.props.badge).toBe('');
    expect(store.getState().nodes.h1!.props.badge).not.toContain('\u200B');
  });
});
