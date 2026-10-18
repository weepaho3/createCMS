import type { ReactNode } from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorDocument } from '../core/document';

import { defineEditorSchema } from '../core/schema';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
import { Canvas } from './index';
import { caretOffsetWithin, EMPTY_FIELD_PLACEHOLDER } from './inline-text';
import {
  canvasBlocks,
  nestedTextBlocks,
  nestedTextSchema,
  nestedTextTree,
} from './test/fixtures';
import { rectClose, rectOf, renderCanvas, waitForLayout } from './test/harness';

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

function longHeadingTree(): EditorDocument {
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
            props: { text: 'HelloWorld', level: 1 },
          },
        ],
      },
    },
  };
}

function inlineOverlay(extra?: ReactNode) {
  return (
    <Canvas.Overlay>
      <Canvas.InlineText />
      {extra}
    </Canvas.Overlay>
  );
}

function clickCenter(el: Element): void {
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    }),
  );
}

function clickAt(el: Element, xFrac: number, yFrac = 0.5): void {
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width * xFrac,
      clientY: rect.y + rect.height * yFrac,
    }),
  );
}

function selectionOffsetIn(el: HTMLElement): number | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  return caretOffsetWithin(el);
}

describe('Canvas inline text in a real browser', () => {
  it('activates the glass on heading text click', async () => {
    const { host } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    expect(host.hasAttribute('data-editing')).toBe(true);
    const glass = host.querySelector('[data-editor-inline-text]');
    expect(glass).not.toBeNull();
    expect(glass?.getAttribute('role')).toBe('textbox');
    expect(glass?.getAttribute('aria-multiline')).toBe('false');
    const origin = field as HTMLElement;
    expect(origin.style.visibility).toBe('hidden');
    expect(rectClose(rectOf(glass!), rectOf(field!))).toBe(true);
  });

  it('places the caret from the click position', async () => {
    const { host } = renderCanvas(inlineOverlay(), {
      tree: longHeadingTree(),
    });
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    await waitForLayout(field!);
    clickAt(field!, 1 / 3);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    expect(
      document.activeElement === glass ||
        glass.contains(document.activeElement),
    ).toBe(true);
    const leftOffset = selectionOffsetIn(glass);
    clickAt(field!, 2 / 3);
    await waitForLayout(host);
    const glass2 = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    const rightOffset = selectionOffsetIn(glass2);
    if (leftOffset !== null && rightOffset !== null) {
      expect(leftOffset).toBeLessThan(rightOffset);
    } else {
      expect(document.activeElement).toBe(
        host.querySelector('[data-editor-inline-text]'),
      );
    }
  });

  it('writes typed text to the store during the session', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'Hi';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(store.getDoc().nodes.h1!.props.text).toBe('Hi');
    expect((field as HTMLElement).style.visibility).toBe('hidden');
  });

  it('Enter ends the session and Shift+Enter does not', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'Done';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getSession().editing).toBeNull();
    expect((field as HTMLElement).style.visibility).not.toBe('hidden');
    expect(store.getDoc().nodes.h1!.props.text).toBe('Done');

    clickCenter(field!);
    await waitForLayout(host);
    const glass2 = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass2.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(store.getSession().editing).not.toBeNull();
  });

  it('Escape ends the session and commits by default', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'Kept';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getSession().editing).toBeNull();
    expect(store.getDoc().nodes.h1!.props.text).toBe('Kept');
  });

  it('leaving the glass without typing records no change', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    const version = store.getDoc().version;
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    expect(document.activeElement).toBe(glass);
    glass.blur();
    await waitForLayout(host);
    expect(store.getSession().editing).toBeNull();
    expect(store.getDoc().version).toBe(version);
    expect(store.getSession().history.canUndo).toBe(false);
    expect(store.isDirty()).toBe(false);
  });

  it('discardOnEscape without typing records no change', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InlineText discardOnEscape />
      </Canvas.Overlay>,
    );
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    const version = store.getDoc().version;
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getSession().editing).toBeNull();
    expect(store.getDoc().version).toBe(version);
    expect(store.isDirty()).toBe(false);
  });

  it('typing then leaving the glass is one undo step', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'Hi';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    glass.blur();
    await waitForLayout(host);
    expect(store.getDoc().nodes.h1!.props.text).toBe('Hi');
    store.undo();
    expect(store.getDoc().nodes.h1!.props.text).toBe('Hello');
    expect(store.getSession().history.canUndo).toBe(false);
  });

  it('discardOnEscape restores the pre-session value', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InlineText discardOnEscape />
      </Canvas.Overlay>,
    );
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'X';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getDoc().nodes.h1!.props.text).toBe('Hello');
  });

  it('nested same-key click targets the inner block', async () => {
    const { host, store } = renderCanvas(inlineOverlay(), {
      schema: nestedTextSchema,
      tree: nestedTextTree(),
      components: nestedTextBlocks,
    });
    const inner = host.querySelector(
      '[data-editor-block="inner1"] [data-editor-field="text"]',
    );
    expect(inner).not.toBeNull();
    await waitForLayout(inner!);
    clickCenter(inner!);
    await waitForLayout(host);
    const glass = host.querySelector('[data-editor-inline-text]');
    expect(glass?.getAttribute('data-field')).toBe('text');
    expect(store.getSession().editing?.blockId).toBe('inner1');
  });

  it('richText click does not start a session and keeps the HTML value', async () => {
    const html = '<p>World <strong>bold</strong> <a href="/x">link</a></p>';
    const tree = makeDoc();
    const para = tree.root.slots!.children![1]!.slots!.children![0]!;
    para.props = { text: html };
    const { host, store } = renderCanvas(inlineOverlay(), { tree });
    const el = host.querySelector('[data-editor-block="p1"]');
    expect(el).not.toBeNull();
    await waitForLayout(el!);
    clickCenter(el!);
    await waitForLayout(host);
    await waitForLayout(el!);
    const selection = {
      selected: store.getSession().selection[0] ?? null,
      focus: store.getSession().focusedField,
      editing: store.getSession().editing,
    };
    expect(selection?.editing).toBeNull();
    expect(selection?.focus).toEqual({ blockId: 'p1', key: 'text' });
    expect(host.querySelector('[data-editor-inline-text]')).toBeNull();
    expect(store.getDoc().nodes.p1!.props.text).toBe(html);
  });

  it('empty badge field can be edited without storing the placeholder', async () => {
    const { host, store } = renderCanvas(inlineOverlay(), {
      schema: badgeSchema,
      tree: badgeTree(),
    });
    const badge = host.querySelector('[data-editor-field="badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe(EMPTY_FIELD_PLACEHOLDER);
    await waitForLayout(badge!);
    clickCenter(badge!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'ok';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    glass.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await waitForLayout(host);
    expect(store.getDoc().nodes.h1!.props.badge).toBe('ok');
    expect(store.getDoc().nodes.h1!.props.badge).not.toContain('\u200B');
  });

  it('suggest keyboard accepts an item and Escape closes the list', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InlineText
          suggest={{
            pattern: /\{\{(\w*)$/,
            getItems: (q) =>
              q === 'n' || q === ''
                ? [{ insertText: '{{name}}', label: 'name' }]
                : [],
            render: (ctx) => (
              <ul data-testid="suggest">
                {ctx.items.map((item, i) => (
                  <li
                    key={i}
                    data-highlighted={i === ctx.highlighted ? '' : undefined}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      ctx.accept(i);
                    }}
                  >
                    {String(item.label)}
                  </li>
                ))}
              </ul>
            ),
          }}
        />
      </Canvas.Overlay>,
    );
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = '{{n';
    const range = document.createRange();
    range.selectNodeContents(glass);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    glass.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForLayout(host);
    expect(host.querySelector('[data-testid="suggest"]')).not.toBeNull();
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(host.querySelector('[data-testid="suggest"]')).toBeNull();
    expect(store.getSession().editing).not.toBeNull();

    glass.textContent = '{{n';
    range.selectNodeContents(glass);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
    glass.dispatchEvent(new Event('input', { bubbles: true }));
    await waitForLayout(host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.querySelector('[data-testid="suggest"]')).not.toBeNull();
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      }),
    );
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getDoc().nodes.h1!.props.text).toBe('{{name}}');
    expect(host.querySelector('[data-testid="suggest"]')).toBeNull();
  });

  it('two canvases on one page keep lookup scoped', async () => {
    const tree = makeDoc();
    const utils = render(
      <div style={{ display: 'flex' }}>
        <Editor.Root schema={storeSchema} defaultValue={tree}>
          <Canvas.Root
            data-testid="canvas-a"
            components={canvasBlocks}
            style={{ width: 400, height: 300, position: 'relative' }}
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
            style={{ width: 400, height: 300, position: 'relative' }}
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
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(hostB);
    const hostA = utils.getByTestId('canvas-a');
    expect(hostA.hasAttribute('data-editing')).toBe(false);
    expect(hostA.querySelector('[data-editor-inline-text]')).toBeNull();
    expect(hostB.hasAttribute('data-editing')).toBe(true);
    expect(hostB.querySelector('[data-editor-inline-text]')).not.toBeNull();
  });

  it('number field click focuses without starting inline text', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const level = host.querySelector('[data-editor-field="level"]');
    expect(level).not.toBeNull();
    await waitForLayout(level!);
    clickCenter(level!);
    await waitForLayout(host);
    expect(store.getSession().focusedField).toEqual({
      blockId: 'h1',
      key: 'level',
    });
    expect(host.querySelector('[data-editor-inline-text]')).toBeNull();
    expect(host.hasAttribute('data-editing')).toBe(false);
  });

  it('undo during the session reverts coalesced typing', async () => {
    const { host, store } = renderCanvas(inlineOverlay());
    const field = host.querySelector('[data-editor-field="text"]');
    await waitForLayout(field!);
    clickCenter(field!);
    await waitForLayout(host);
    const glass = host.querySelector(
      '[data-editor-inline-text]',
    ) as HTMLElement;
    glass.textContent = 'ab';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getDoc().nodes.h1!.props.text).toBe('Hello');
    expect(glass.textContent).toBe('Hello');
    expect(store.getSession().editing).not.toBeNull();
  });
});
