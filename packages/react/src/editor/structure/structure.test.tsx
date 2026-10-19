// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../core/store';

import { useEditorContext } from '../context';
import { defineEditorSchema } from '../core/schema';
import { counterGenId, makeDoc, storeSchema } from '../core/store/fixtures';
import { useBlockActions, useChildren } from '../hooks';
import { Editor } from '../index';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function mount(ui?: React.ReactNode) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeDoc()}
      genId={counterGenId()}
    >
      <StoreProbe probe={probe} />
      {ui}
    </Editor.Root>,
  );
  return { ...utils, probe };
}

describe('Editor.AddBlock', () => {
  it('with nothing selected inserts at the end of the root and selects it', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="heading" />);
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getDoc().nodes.root_1?.slots.children).toEqual([
      'h1',
      'sec1',
      'n1',
    ]);
    expect(probe.store?.getSession().selection[0] ?? null).toBe('n1');
  });

  it('with sec1 selected inserts inside sec1', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="heading" />);
    act(() => {
      probe.store?.select('sec1');
    });
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getDoc().nodes.sec1?.slots.children).toEqual([
      'p1',
      'n1',
    ]);
  });

  it('with h1 selected inserts after h1 in the root', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="heading" />);
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getDoc().nodes.root_1?.slots.children).toEqual([
      'h1',
      'n1',
      'sec1',
    ]);
  });

  it('explicit parentId and index insert first under sec1', () => {
    const { getByRole, probe } = mount(
      <Editor.AddBlock type="heading" parentId="sec1" index={0} />,
    );
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getDoc().nodes.sec1?.slots.children).toEqual([
      'n1',
      'p1',
    ]);
  });

  it('type=image with sec1 selected inserts after sec1 in the root', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="image" />);
    act(() => {
      probe.store?.select('sec1');
    });
    const button = getByRole('button', { name: 'Image' });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(probe.store?.getDoc().nodes.root_1?.slots.children).toEqual([
      'h1',
      'sec1',
      'n1',
    ]);
  });

  it('type=image parentId=sec1 is disabled; with nothing selected it is enabled', () => {
    const disabled = mount(<Editor.AddBlock type="image" parentId="sec1" />);
    expect(disabled.getByRole('button', { name: 'Image' })).toHaveProperty(
      'disabled',
      true,
    );
    disabled.unmount();
    const open = mount(<Editor.AddBlock type="image" />);
    expect(open.getByRole('button', { name: 'Image' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('label defaults to the palette label and children override', () => {
    const def = mount(<Editor.AddBlock type="heading" />);
    expect(def.getByRole('button').textContent).toBe('Heading');
    def.unmount();
    const custom = mount(
      <Editor.AddBlock type="heading">Insert heading</Editor.AddBlock>,
    );
    expect(custom.getByRole('button').textContent).toBe('Insert heading');
  });

  it('sets data-block-type', () => {
    const { getByRole } = mount(<Editor.AddBlock type="heading" />);
    expect(getByRole('button').getAttribute('data-block-type')).toBe('heading');
  });

  it('throws the precise message outside Editor.Root', () => {
    expect(() => render(<Editor.AddBlock type="heading" />)).toThrow(
      'Editor.AddBlock must be used within an Editor.Root component.',
    );
    expect(() => render(<Editor.Outline />)).toThrow(
      'Editor.Outline must be used within an Editor.Root component.',
    );
  });
});

describe('stacked form', () => {
  it('recurses useChildren + Editor.Form and grows after add', () => {
    const probe: Probe = { store: null };
    let add: ((type: string) => string | null) | undefined;
    function Actions() {
      const actions = useBlockActions('sec1');
      add = (type) => actions.add(type);
      return null;
    }
    function Stack({ blockId }: { blockId: string }) {
      const children = useChildren(blockId);
      return (
        <>
          <Editor.Form blockId={blockId} />
          {children.map((child) => (
            <Stack key={child.id} blockId={child.id} />
          ))}
        </>
      );
    }
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
        <StoreProbe probe={probe} />
        <Actions />
        <Stack blockId="root_1" />
      </Editor.Root>,
    );
    expect(container.querySelectorAll('[data-block-type]')).toHaveLength(4);
    const labels = [...container.querySelectorAll('label')].map(
      (el) => el.textContent,
    );
    expect(labels.filter((text) => text === 'Title')).toHaveLength(2);
    expect(labels).toContain('Text');
    expect(labels).toContain('Level');
    expect(labels).toContain('Body');
    act(() => {
      add?.('paragraph');
    });
    expect(container.querySelectorAll('[data-block-type]')).toHaveLength(5);
  });
});

describe('named slots', () => {
  const slotSchema = defineEditorSchema({
    root: { label: 'Root', fields: {}, slots: { children: {} } },
    components: {
      columns: {
        label: 'Columns',
        fields: {},
        slots: {
          left: { label: 'Left column', allow: ['text'] },
          right: { max: 1 },
        },
      },
      text: { label: 'Text', fields: {} },
    },
  });

  function mountSlots(ui: React.ReactNode) {
    const probe: Probe = { store: null };
    const utils = render(
      <Editor.Root
        schema={slotSchema}
        defaultValue={{
          schemaVersion: 1,
          root: {
            id: 'r',
            type: 'root',
            props: {},
            slots: {
              children: [
                {
                  id: 'cols',
                  type: 'columns',
                  props: {},
                  slots: { left: [], right: [] },
                },
              ],
            },
          },
        }}
        genId={counterGenId()}
      >
        <StoreProbe probe={probe} />
        {ui}
      </Editor.Root>,
    );
    return { ...utils, probe };
  }

  it('AddBlock with a slot inserts there and disables when the slot is full', () => {
    const { getByRole, probe } = mountSlots(
      <Editor.AddBlock type="text" parentId="cols" slot="right" />,
    );
    const button = getByRole('button', { name: 'Text' });
    fireEvent.click(button);
    expect(probe.store?.getDoc().nodes.cols?.slots.right).toEqual(['n1']);
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('AddBlock refuses a type the slot does not allow', () => {
    const { getByRole, probe } = mountSlots(
      <Editor.AddBlock type="columns" parentId="cols" slot="left" />,
    );
    const button = getByRole('button', { name: 'Columns' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(probe.store?.getDoc().nodes.cols?.slots.left).toEqual([]);
  });
});
