// @vitest-environment happy-dom
import type * as React from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorDocument } from '../core/document';
import type { EditProps } from '../core/edit';
import type { CanvasComponent, CanvasComponentProps } from './map';

import { resetWarnings } from '../core/codes';
import { defineEditorSchema } from '../core/schema';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
import { Canvas } from './index';
import { EMPTY_FIELD_PLACEHOLDER } from './inline-text';
import { canvasBlocks, Heading } from './test/fixtures';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

const cardSchema = defineEditorSchema({
  root: { label: 'Cards', fields: {}, slots: { children: {} } },
  components: {
    card: {
      label: 'Card',
      fields: {
        source: { type: 'reference', collection: 'items', label: 'Source' },
      },
    },
  },
});

function twoCards(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          { id: 'c1', type: 'card', props: { source: { id: 'abc' } } },
          { id: 'c2', type: 'card', props: { source: { id: 'abc' } } },
        ],
      },
    },
  };
}

function Card({ props, edit }: CanvasComponentProps) {
  const source = props.source as { title?: string; id?: string } | undefined;
  return (
    <div {...edit.block} data-testid="card">
      {source?.title ?? `raw:${source?.id ?? ''}`}
    </div>
  );
}

const cardBlocks = { card: Card };

describe('Canvas.Root renderer', () => {
  it('renders the root as a fragment of child blocks', () => {
    const { host } = renderCanvas();
    expect(
      [...host.children].map((el) => el.getAttribute('data-editor-block')),
    ).toEqual(['h1', 'sec1']);
  });

  it('passes id, type, props and edit anchors', () => {
    let seen: CanvasComponentProps | undefined;
    const HeadingProbe: CanvasComponent = (props) => {
      seen = props;
      return (
        <Heading
          props={props.props as { text: string; level: number }}
          edit={props.edit}
        />
      );
    };
    renderCanvas(undefined, {
      components: { ...canvasBlocks, heading: HeadingProbe },
    });
    expect(seen?.id).toBe('h1');
    expect(seen?.type).toBe('heading');
    expect(seen?.props).toEqual({ text: 'Hello', level: 1 });
    expect(seen?.edit.active).toBe(true);
    expect(seen?.edit.block).toEqual({ 'data-editor-block': 'h1' });
    expect(seen?.edit.field).toEqual({
      text: { 'data-editor-field': 'text' },
      level: { 'data-editor-field': 'level' },
    });
    expect(seen?.edit.slot).toBeUndefined();
  });

  it('adds slot anchors for components with slots', () => {
    let edit: EditProps | undefined;
    const SectionProbe: CanvasComponent = (props) => {
      edit = props.edit;
      return <section {...props.edit.block}>{props.children}</section>;
    };
    renderCanvas(undefined, {
      components: { ...canvasBlocks, section: SectionProbe },
    });
    expect(edit?.slot).toEqual({
      children: { 'data-editor-slot': 'children' },
    });
  });

  it('shows an unknown type as a selectable Canvas.UnknownBlock and keeps its data', () => {
    resetWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tree: EditorDocument = {
      schemaVersion: 1,
      root: {
        id: 'root_1',
        type: 'root',
        props: {},
        slots: { children: [{ id: 'w1', type: 'widget', props: {} }] },
      },
    };
    const { host, store } = renderCanvas(undefined, { tree });
    const unknown = host.querySelector('[data-unknown-block]');
    expect(unknown?.getAttribute('data-editor-block')).toBe('w1');
    expect(unknown?.textContent).toContain('widget');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[editor:E006]'));
    expect(store.getDocument()).toEqual(tree);
    warn.mockRestore();
  });

  it('calls a field resolver once per stored value and renders its result', () => {
    const reference = vi.fn((value: unknown) => ({
      ...(value as object),
      title: 'Resolved',
    }));
    const { rerender, container } = render(
      <Editor.Root schema={cardSchema} defaultValue={twoCards()}>
        <Canvas.Root components={cardBlocks} resolve={{ reference }} />
      </Editor.Root>,
    );
    expect(reference).toHaveBeenCalledTimes(1);
    rerender(
      <Editor.Root schema={cardSchema} defaultValue={twoCards()}>
        <Canvas.Root components={cardBlocks} resolve={{ reference }} />
      </Editor.Root>,
    );
    expect(reference).toHaveBeenCalledTimes(1);
    const cards = container.querySelectorAll('[data-testid="card"]');
    expect([...cards].map((c) => c.textContent)).toEqual([
      'Resolved',
      'Resolved',
    ]);
  });

  it('keeps the stored value and sets data-unresolved while a resolver misses', () => {
    const { host } = renderCanvas(undefined, {
      schema: cardSchema,
      tree: twoCards(),
      components: cardBlocks,
      resolve: { reference: () => undefined },
    });
    const card = host.querySelector('[data-testid="card"]');
    expect(card?.textContent).toBe('raw:abc');
    expect(card?.getAttribute('data-unresolved')).toBe('');
  });

  it('renders kinds without a resolver as stored, without data-unresolved', () => {
    const { host } = renderCanvas(undefined, {
      schema: cardSchema,
      tree: twoCards(),
      components: cardBlocks,
    });
    const card = host.querySelector('[data-testid="card"]');
    expect(card?.textContent).toBe('raw:abc');
    expect(card?.hasAttribute('data-unresolved')).toBe(false);
  });

  it('throws when surface is frame', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
          <Canvas.Root components={canvasBlocks} surface="frame" />
        </Editor.Root>,
      ),
    ).toThrow('Canvas.Root: surface "frame" is not implemented');
  });

  it('Canvas.ReadonlySubtree is inert and its blocks are not selectable', () => {
    const SectionWithEmbed: CanvasComponent = (props) => (
      <section {...props.edit.block}>
        {props.children}
        <Canvas.ReadonlySubtree>
          <article data-editor-block="embedded">Embedded</article>
        </Canvas.ReadonlySubtree>
      </section>
    );
    const { host, store } = renderCanvas(undefined, {
      components: { ...canvasBlocks, section: SectionWithEmbed },
    });
    const readonly = host.querySelector('[data-editor-readonly][inert]');
    expect(readonly).not.toBeNull();
    expect((readonly as HTMLElement).style.display).toBe('contents');
    const inner = host.querySelector('article');
    inner!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getSession().selection[0] ?? null).not.toBe('embedded');
  });

  it('intercepts a[href] clicks with preventDefault', () => {
    const { host } = renderCanvas(<a href="https://example.com">Go</a>);
    const link = host.querySelector('a');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('warns when a mapped block renders no data-editor-block', async () => {
    resetWarnings();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const Broken = (): React.ReactNode => <span />;
    renderCanvas(undefined, {
      tree: {
        schemaVersion: 1,
        root: {
          id: 'root_1',
          type: 'root',
          props: {},
          slots: {
            children: [
              { id: 'h1', type: 'heading', props: { text: 'Hello', level: 1 } },
            ],
          },
        },
      },
      components: { heading: Broken },
    });
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        '[editor:E005] Canvas.Root: block "h1" (type "heading") rendered no [data-editor-block] attribute.',
      ),
    );
    warn.mockRestore();
  });

  it('keeps an empty text field mounted with a display placeholder', () => {
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
    const { host, store } = renderCanvas(undefined, {
      schema: badgeSchema,
      tree: {
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
      },
    });
    const badge = host.querySelector('[data-editor-field="badge"]');
    expect(badge?.textContent).toBe(EMPTY_FIELD_PLACEHOLDER);
    expect(store.getDoc().nodes.h1!.props.badge).toBe('');
  });
});
