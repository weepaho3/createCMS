import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorDocument } from '../core/document';
import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { defineEditorSchema } from '../core/schema';
import { createEditorStore } from '../core/store';
import { Editor } from '../index';
import { Canvas, useEditableField } from './index';
import { waitForLayout } from './test/harness';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Page', fields: {}, slots: { children: {} } },
  components: {
    heading: {
      label: 'Heading',
      fields: { text: { type: 'text', label: 'Title', maxLength: 10 } },
    },
    hero: {
      label: 'Hero',
      fields: {
        title: {
          type: 'text',
          label: 'Hero title',
          inline: 'in-place',
          maxLength: 10,
        },
      },
    },
  },
});

function doc(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'r',
      type: 'root',
      props: {},
      slots: {
        children: [
          { id: 'h', type: 'heading', props: { text: 'Hello' } },
          { id: 'x', type: 'hero', props: { title: 'Glow' } },
        ],
      },
    },
  };
}

function Heading({
  props,
  edit,
}: {
  props: { text: string };
  edit: EditProps;
}) {
  return (
    <h2 {...edit.block} {...edit.field.text} style={{ width: 300 }}>
      {props.text}
    </h2>
  );
}

function Hero({
  id,
  props,
  edit,
}: {
  id: string;
  props: { title: string };
  edit: EditProps;
}) {
  const title = useEditableField(id, 'title');
  return (
    <section {...edit.block}>
      <h1
        {...edit.field.title}
        {...title.props}
        data-testid="hero-title"
        style={{
          backgroundImage: 'linear-gradient(90deg, red, blue)',
          backgroundClip: 'text',
          color: 'transparent',
          width: 300,
        }}
      >
        {title.editable ? null : props.title}
      </h1>
    </section>
  );
}

const components = {
  heading: Heading,
  hero: Hero,
} as unknown as CanvasComponents;

function mount() {
  const store = createEditorStore({ schema, initialValue: doc() });
  const utils = render(
    <Editor.Root store={store}>
      <Canvas.Root components={components} data-testid="canvas">
        <Canvas.Overlay>
          <Canvas.InlineText />
        </Canvas.Overlay>
      </Canvas.Root>
    </Editor.Root>,
  );
  return { store, host: utils.getByTestId('canvas') };
}

async function openGlass(host: HTMLElement) {
  const field = host.querySelector('[data-editor-field="text"]')!;
  await waitForLayout(field);
  const rect = field.getBoundingClientRect();
  field.dispatchEvent(
    new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    }),
  );
  await waitForLayout(host);
  return host.querySelector('[data-editor-inline-text]') as HTMLElement;
}

function beforeInput(el: HTMLElement, init: InputEventInit): InputEvent {
  const event = new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  el.dispatchEvent(event);
  return event;
}

describe('plain-text rules in the glass', () => {
  it('cancels line breaks in a single-line field', async () => {
    const { host, store } = mount();
    const glass = await openGlass(host);
    glass.textContent = 'typed';
    glass.dispatchEvent(new InputEvent('input', { bubbles: true }));
    expect(store.getDoc().nodes.h!.props.text).toBe('typed');
    expect(
      beforeInput(glass, { inputType: 'insertParagraph' }).defaultPrevented,
    ).toBe(true);
    expect(
      beforeInput(glass, { inputType: 'insertLineBreak' }).defaultPrevented,
    ).toBe(true);
  });

  it('enforces maxLength while typing', async () => {
    const { host } = mount();
    const glass = await openGlass(host);
    glass.textContent = '0123456789';
    expect(
      beforeInput(glass, { inputType: 'insertText', data: 'x' })
        .defaultPrevented,
    ).toBe(true);
  });

  it('pastes multi-line text as one line, cut to maxLength', async () => {
    const { host, store } = mount();
    const glass = await openGlass(host);
    glass.textContent = '';
    glass.focus();
    const selection = document.getSelection()!;
    selection.selectAllChildren(glass);
    const data = new DataTransfer();
    data.setData('text/plain', 'one\ntwo\nthree');
    const event = beforeInput(glass, {
      inputType: 'insertFromPaste',
      dataTransfer: data,
    });
    expect(event.defaultPrevented).toBe(true);
    expect(store.getDoc().nodes.h!.props.text).toBe('one two th');
  });

  it('Enter during an IME composition does not end the session', async () => {
    const { host, store } = mount();
    const glass = await openGlass(host);
    glass.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true }),
    );
    glass.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    );
    await waitForLayout(host);
    expect(store.getSession().editing).not.toBeNull();
    glass.textContent = 'かな';
    glass.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true }),
    );
    expect(store.getDoc().nodes.h!.props.text).toBe('かな');
  });
});

describe('useEditableField', () => {
  it('edits the gradient title in place: no glass, string prop, no layout change', async () => {
    const { host, store } = mount();
    const title = host.querySelector(
      '[data-testid="hero-title"]',
    ) as HTMLElement;
    await waitForLayout(title);
    expect(title.textContent).toBe('Glow');
    const before = title.getBoundingClientRect();
    title.dispatchEvent(new PointerEvent('pointerenter'));
    await act(async () => {
      title.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    });
    act(() => {
      title.focus();
    });
    expect(store.getSession().editing).toEqual({ blockId: 'x', key: 'title' });
    expect(host.querySelector('[data-editor-inline-text]')).toBeNull();
    const after = title.getBoundingClientRect();
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
    title.textContent = 'Shine';
    act(() => {
      title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(store.getDoc().nodes.x!.props.title).toBe('Shine');
    expect(typeof store.getDoc().nodes.x!.props.title).toBe('string');
  });

  it('undo during the session shows the undone value', async () => {
    const { host, store } = mount();
    const title = host.querySelector(
      '[data-testid="hero-title"]',
    ) as HTMLElement;
    await waitForLayout(title);
    act(() => {
      title.focus();
    });
    title.textContent = 'Shine';
    act(() => {
      title.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    act(() => {
      title.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(store.getDoc().nodes.x!.props.title).toBe('Glow');
    expect(title.textContent).toBe('Glow');
  });
});
