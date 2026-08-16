// @vitest-environment happy-dom
import type { BlockTreeNode, CollectionDefinition } from '@createcms/schema';
import type * as React from 'react';

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorStore } from '../store';
import type {
  AnyFieldControlProps,
  FieldControlProps,
  FieldControls,
} from './types';

import { useEditorContext } from '../context';
import { useMissingRequired } from '../hooks';
import { Editor } from '../index';
import { useFieldContext } from './context';
import {
  emptyListElement,
  fromDatetimeLocal,
  toDatetimeLocal,
} from './controls';

afterEach(cleanup);

// --- fixtures ---------------------------------------------------------------

const formSchema = {
  label: 'Form',
  root: {
    properties: {
      title: { type: 'string', label: 'Title', required: true },
    },
  },
  blocks: {
    demo: {
      label: 'Demo',
      properties: {
        text: {
          type: 'string',
          label: 'Text',
          placeholder: 'Type',
          maxLength: 10,
          description: 'Short text',
        },
        body: { type: 'richText', label: 'Body' },
        count: { type: 'number', label: 'Count', min: 0 },
        flag: { type: 'boolean', label: 'Flag' },
        when: { type: 'date', label: 'When' },
        pick: {
          type: 'select',
          label: 'Pick',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        },
        tags: {
          type: 'list',
          label: 'Tags',
          of: { type: 'string' },
          min: 1,
          max: 3,
        },
        cover: { type: 'image', label: 'Cover', group: 'Meta' },
        target: {
          type: 'reference',
          label: 'Target',
          collection: 'pages',
          group: 'Meta',
        },
        link: { type: 'link', label: 'Link' },
      },
    },
  },
} satisfies CollectionDefinition;

const ROOT = 'root_1';
const DEMO = 'd1';

function makeTree(): BlockTreeNode {
  return {
    blockId: ROOT,
    type: 'root',
    properties: { title: 'Home' },
    children: [
      {
        blockId: DEMO,
        type: 'demo',
        properties: {
          text: 'Hi',
          count: 2,
          flag: true,
          when: '2026-08-16T10:30:00.000Z',
          pick: 'a',
          tags: ['x', 'y'],
        },
        children: [],
      },
    ],
  };
}

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

/** A control for any kind that only reports what it received. */
function Stub(props: {
  id: string;
  name: string;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
}) {
  return (
    <input
      data-testid={`stub-${props.name}`}
      id={props.id}
      name={props.name}
      disabled={props.disabled}
      readOnly
    />
  );
}

const stubs: FieldControls = { image: Stub, reference: Stub, link: Stub };

let lastCustomProps: FieldControlProps<'string'> | null = null;
function Custom(props: FieldControlProps<'string'>) {
  lastCustomProps = props;
  return (
    <input
      data-testid="custom"
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

type FieldTreeOptions = {
  blockId?: string;
  disabled?: boolean;
  fields?: FieldControls;
  labelChildren?: React.ReactNode;
  controlRender?: (props: AnyFieldControlProps) => React.ReactElement | null;
};

function fieldTree(name: string, probe: Probe, options: FieldTreeOptions = {}) {
  const {
    blockId = DEMO,
    disabled,
    fields,
    labelChildren,
    controlRender,
  } = options;
  return (
    <Editor.Root schema={formSchema} defaultValue={makeTree()} fields={fields}>
      <StoreProbe probe={probe} />
      <Editor.Field
        blockId={blockId}
        name={name}
        disabled={disabled}
        data-testid="field"
      >
        <Editor.FieldLabel>{labelChildren}</Editor.FieldLabel>
        <Editor.FieldControl render={controlRender} />
        <Editor.FieldDescription />
        <Editor.FieldError />
      </Editor.Field>
    </Editor.Root>
  );
}

function renderField(name: string, options: FieldTreeOptions = {}) {
  const probe: Probe = { store: null };
  const utils = render(fieldTree(name, probe, options));
  if (!probe.store) throw new Error('store probe did not mount');
  const store = probe.store;
  const blockId = options.blockId ?? DEMO;
  return {
    ...utils,
    store,
    props: () => store.getState().nodes[blockId]?.properties ?? {},
    field: () => utils.getByTestId('field'),
  };
}

// --- built-in controls ------------------------------------------------------

describe('built-in controls', () => {
  it('string: text input with value, placeholder and maxLength; change writes the store', () => {
    const { container, props } = renderField('text');
    const input = container.querySelector('input');
    expect(input?.getAttribute('type')).toBe('text');
    expect(input?.value).toBe('Hi');
    expect(input?.getAttribute('placeholder')).toBe('Type');
    expect(input?.getAttribute('maxlength')).toBe('10');
    fireEvent.change(input as HTMLInputElement, { target: { value: 'Hey' } });
    expect(props().text).toBe('Hey');
    expect(input?.value).toBe('Hey');
  });

  it('richText: textarea round trip', () => {
    const { container, props } = renderField('body');
    const area = container.querySelector('textarea');
    expect(area).not.toBeNull();
    expect(area?.value).toBe('');
    fireEvent.change(area as HTMLTextAreaElement, {
      target: { value: 'Body text' },
    });
    expect(props().body).toBe('Body text');
    expect(area?.value).toBe('Body text');
  });

  it('number: numeric value in, number out; empty deletes the property', () => {
    const { container, props } = renderField('count');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('number');
    expect(input.value).toBe('2');
    expect(input.getAttribute('min')).toBe('0');
    fireEvent.change(input, { target: { value: '5' } });
    expect(props().count).toBe(5);
    fireEvent.change(input, { target: { value: '' } });
    expect('count' in props()).toBe(false);
  });

  it('boolean: checkbox reflects the value; click toggles it', () => {
    const { container, props } = renderField('flag');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('checkbox');
    expect(input.checked).toBe(true);
    fireEvent.click(input);
    expect(props().flag).toBe(false);
    expect(input.checked).toBe(false);
  });

  it('date: datetime-local shows local time and writes ISO UTC back; empty deletes', () => {
    const { container, props } = renderField('when');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('type')).toBe('datetime-local');
    expect(input.value).toBe(toDatetimeLocal('2026-08-16T10:30:00.000Z'));
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    fireEvent.change(input, {
      target: { value: toDatetimeLocal('2026-08-17T08:15:00.000Z') },
    });
    expect(props().when).toBe('2026-08-17T08:15:00.000Z');
    fireEvent.change(input, { target: { value: '' } });
    expect('when' in props()).toBe(false);
  });

  it('toDatetimeLocal/fromDatetimeLocal: invalid input yields empty/undefined; valid input round-trips', () => {
    expect(toDatetimeLocal(undefined)).toBe('');
    expect(toDatetimeLocal('')).toBe('');
    expect(toDatetimeLocal('not a date')).toBe('');
    expect(fromDatetimeLocal('')).toBeUndefined();
    expect(fromDatetimeLocal('nope')).toBeUndefined();
    const iso = '2026-01-01T00:00:00.000Z';
    expect(fromDatetimeLocal(toDatetimeLocal(iso))).toBe(iso);
  });

  it('select: leading empty option plus the options; change writes; empty deletes', () => {
    const { container, props } = renderField('pick');
    const select = container.querySelector('select') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map((option) => option.value)).toEqual(['', 'a', 'b']);
    expect(select.value).toBe('a');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(props().pick).toBe('b');
    fireEvent.change(select, { target: { value: '' } });
    expect('pick' in props()).toBe(false);
  });

  it('list: one row per element with a string input each', () => {
    const { container } = renderField('tags');
    const rows = container.querySelectorAll('li');
    expect(rows.length).toBe(2);
    const inputs = Array.from(container.querySelectorAll('li input'));
    expect(inputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'x',
      'y',
    ]);
    fireEvent.change(inputs[1] as HTMLInputElement, {
      target: { value: 'z' },
    });
    expect(
      Array.from(container.querySelectorAll('li input')).map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['x', 'z']);
  });

  it('list: Add appends an empty element and is disabled at max', () => {
    const { container, props, getByRole } = renderField('tags');
    const add = getByRole('button', { name: 'Add Tags' });
    expect((add as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(add);
    expect(props().tags).toEqual(['x', 'y', '']);
    expect(container.querySelectorAll('li').length).toBe(3);
    expect((add as HTMLButtonElement).disabled).toBe(true);
  });

  it('list: Remove drops the row and is disabled at min', () => {
    const { container, props, getByRole } = renderField('tags');
    fireEvent.click(getByRole('button', { name: 'Remove Tags 2' }));
    expect(props().tags).toEqual(['x']);
    expect(container.querySelectorAll('li').length).toBe(1);
    expect(
      (getByRole('button', { name: 'Remove Tags 1' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('list: Move down swaps rows; Move up is disabled on the first row', () => {
    const { props, getByRole } = renderField('tags');
    expect(
      (getByRole('button', { name: 'Move Tags 1 up' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (getByRole('button', { name: 'Move Tags 2 down' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(getByRole('button', { name: 'Move Tags 1 down' }));
    expect(props().tags).toEqual(['y', 'x']);
    fireEvent.click(getByRole('button', { name: 'Move Tags 2 up' }));
    expect(props().tags).toEqual(['x', 'y']);
  });

  it('list: elements resolve through the fields map like top-level fields', () => {
    const probe: Probe = { store: null };
    const { getAllByTestId } = render(
      <Editor.Root
        schema={formSchema}
        defaultValue={makeTree()}
        fields={{ string: Custom }}
      >
        <StoreProbe probe={probe} />
        <Editor.Field blockId={DEMO} name="tags">
          <Editor.FieldControl />
        </Editor.Field>
        <Editor.Field blockId={DEMO} name="text">
          <Editor.FieldControl />
        </Editor.Field>
      </Editor.Root>,
    );
    const customs = getAllByTestId('custom') as HTMLInputElement[];
    expect(customs.map((input) => input.value)).toEqual(['x', 'y', 'Hi']);
    expect(customs.map((input) => input.name)).toEqual([
      'tags[0]',
      'tags[1]',
      'text',
    ]);
    fireEvent.change(customs[0] as HTMLInputElement, {
      target: { value: 'X' },
    });
    expect(probe.store?.getState().nodes[DEMO]?.properties.tags).toEqual([
      'X',
      'y',
    ]);
  });

  it('emptyListElement: number 0, boolean false, select first option, string empty', () => {
    expect(emptyListElement({ type: 'number' })).toBe(0);
    expect(emptyListElement({ type: 'boolean' })).toBe(false);
    expect(
      emptyListElement({
        type: 'select',
        options: [{ label: 'First', value: 'first' }],
      }),
    ).toBe('first');
    expect(emptyListElement({ type: 'select', options: [] })).toBe('');
    expect(emptyListElement({ type: 'string' })).toBe('');
    expect(emptyListElement({ type: 'date' })).toBe('');
  });
});

// --- control resolution -----------------------------------------------------

describe('control resolution', () => {
  it('fields map: a scalar override receives the control props and writes the store', () => {
    lastCustomProps = null;
    const { getByTestId, props } = renderField('text', {
      fields: { string: Custom },
    });
    const custom = getByTestId('custom') as HTMLInputElement;
    expect(custom.value).toBe('Hi');
    const received = lastCustomProps as FieldControlProps<'string'> | null;
    expect(received).not.toBeNull();
    expect(received?.spec.type).toBe('string');
    expect(received?.spec.label).toBe('Text');
    expect(received?.value).toBe('Hi');
    expect(received?.id).toBe(custom.getAttribute('id'));
    expect(received?.name).toBe('text');
    expect(received?.required).toBe(false);
    expect(received?.disabled).toBe(false);
    expect(received?.invalid).toBe(false);
    expect(typeof received?.describedBy).toBe('string');
    act(() => received?.onChange('Z'));
    expect(props().text).toBe('Z');
  });

  it('render prop on Editor.FieldControl wins over the map and the default', () => {
    const { getByTestId, queryByTestId, container, props } = renderField(
      'text',
      {
        fields: { string: Custom },
        controlRender: (p) => (
          <input
            data-testid="r"
            value={String(p.value ?? '')}
            onChange={(event) => p.onChange(event.target.value)}
          />
        ),
      },
    );
    expect(queryByTestId('custom')).toBeNull();
    expect(container.querySelectorAll('input').length).toBe(1);
    const input = getByTestId('r') as HTMLInputElement;
    expect(input.value).toBe('Hi');
    fireEvent.change(input, { target: { value: 'R' } });
    expect(props().text).toBe('R');
  });

  it('image without a map entry renders no control and warns once; with an entry it renders it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const probe: Probe = { store: null };
    const { container, rerender } = render(fieldTree('cover', probe));
    expect(container.querySelector('label')).not.toBeNull();
    expect(container.querySelector('input, select, textarea')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"image"');
    expect(String(warn.mock.calls[0]?.[0])).toContain('"cover"');
    rerender(fieldTree('cover', probe));
    expect(warn).toHaveBeenCalledTimes(1);
    cleanup();
    const withMap = renderField('cover', { fields: { image: Stub } });
    expect(withMap.getByTestId('stub-cover')).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  for (const [name, kind] of [
    ['target', 'reference'],
    ['link', 'link'],
  ] as const) {
    it(`${kind} without a map entry renders no control and warns once; with an entry it renders it`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { container } = renderField(name);
      expect(container.querySelector('input, select, textarea')).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(`"${kind}"`);
      cleanup();
      const withMap = renderField(name, { fields: stubs });
      expect(withMap.getByTestId(`stub-${name}`)).not.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });
  }
});

// --- parts ------------------------------------------------------------------

describe('Editor.FieldLabel', () => {
  it('points at the control and shows the spec label; children win', () => {
    const { container } = renderField('text');
    const label = container.querySelector('label') as HTMLLabelElement;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(label.textContent).toBe('Text');
    expect(label.getAttribute('for')).toBe(input.getAttribute('id'));
    expect(input.getAttribute('id')).toBeTruthy();
    cleanup();
    const custom = renderField('text', { labelChildren: 'Custom label' });
    expect(custom.container.querySelector('label')?.textContent).toBe(
      'Custom label',
    );
  });

  it('carries data-required on a required field only', () => {
    const optional = renderField('text');
    expect(
      optional.container.querySelector('label')?.hasAttribute('data-required'),
    ).toBe(false);
    cleanup();
    const required = renderField('title', { blockId: ROOT });
    expect(
      required.container.querySelector('label')?.getAttribute('data-required'),
    ).toBe('');
  });
});

describe('Editor.FieldDescription', () => {
  it('renders the spec description and the control references it', () => {
    const { container } = renderField('text');
    const description = container.querySelector('p') as HTMLParagraphElement;
    const input = container.querySelector('input') as HTMLInputElement;
    expect(description.textContent).toBe('Short text');
    expect(description.getAttribute('id')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBe(
      description.getAttribute('id'),
    );
  });

  it('renders nothing without a description and leaves aria-describedby unset', () => {
    const { container } = renderField('body');
    expect(container.querySelector('p')).toBeNull();
    const area = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('Editor.FieldError', () => {
  it('appears while invalid, marks the control and joins aria-describedby', () => {
    const { container, queryByRole } = renderField('text');
    const input = container.querySelector('input') as HTMLInputElement;
    const descriptionId = container.querySelector('p')?.getAttribute('id');
    expect(queryByRole('alert')).toBeNull();
    fireEvent.change(input, { target: { value: '12345678901' } });
    const alert = queryByRole('alert') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toBe('Must be at most 10 characters.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(
      `${descriptionId} ${alert.getAttribute('id')}`,
    );
    fireEvent.change(input, { target: { value: 'ok' } });
    expect(queryByRole('alert')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(descriptionId);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });

  it('required root title: clearing it yields the required error and the data attributes', () => {
    const { container, field, queryByRole } = renderField('title', {
      blockId: ROOT,
    });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(field().getAttribute('data-kind')).toBe('string');
    expect(field().getAttribute('data-required')).toBe('');
    expect(field().hasAttribute('data-invalid')).toBe(false);
    fireEvent.change(input, { target: { value: '' } });
    expect(queryByRole('alert')?.textContent).toBe('This field is required.');
    expect(field().getAttribute('data-invalid')).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('aria-invalid is absent, not "false", on a valid field', () => {
    const { container } = renderField('text');
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('Editor.Field', () => {
  it('syncs focus into the store once and mirrors it as data-focused', () => {
    const { container, field, store } = renderField('text');
    const input = container.querySelector('input') as HTMLInputElement;
    const focus = vi.spyOn(store, 'focus');
    expect(field().hasAttribute('data-focused')).toBe(false);
    fireEvent.focus(input);
    expect(store.getState().selection.local?.focus).toEqual({
      blockId: DEMO,
      key: 'text',
    });
    expect(field().getAttribute('data-focused')).toBe('');
    fireEvent.focus(input);
    expect(focus).toHaveBeenCalledTimes(1);
    focus.mockRestore();
  });

  it('disabled disables the control and marks field and label', () => {
    const { container, field } = renderField('text', { disabled: true });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(field().getAttribute('data-disabled')).toBe('');
    expect(
      container.querySelector('label')?.getAttribute('data-disabled'),
    ).toBe('');
  });

  it('renders nothing and warns once for an undeclared key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, queryByTestId, rerender } = (() => {
      const probe: Probe = { store: null };
      const utils = render(fieldTree('nope', probe));
      return {
        ...utils,
        rerender: () => utils.rerender(fieldTree('nope', probe)),
      };
    })();
    expect(queryByTestId('field')).toBeNull();
    expect(container.querySelector('label')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('"nope"');
    rerender();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('parts and useFieldContext throw a precise error outside Editor.Field', () => {
    expect(() => render(<Editor.FieldLabel />)).toThrow(
      'Editor.FieldLabel must be used within an Editor.Field component.',
    );
    expect(() => renderHook(() => useFieldContext('X'))).toThrow(
      'X must be used within an Editor.Field component.',
    );
  });

  it('render prop: the function form receives the div props and the state, the element form is cloned', () => {
    const seen: { props: Record<string, unknown>; state: unknown }[] = [];
    const probe: Probe = { store: null };
    render(
      <Editor.Root schema={formSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Editor.Field
          blockId={DEMO}
          name="text"
          render={(props, state) => {
            seen.push({ props: props as Record<string, unknown>, state });
            return <section {...props} />;
          }}
        >
          <Editor.FieldControl />
        </Editor.Field>
        <Editor.Field
          blockId={DEMO}
          name="count"
          render={<section data-testid="section" />}
        >
          <Editor.FieldControl />
        </Editor.Field>
      </Editor.Root>,
    );
    const first = seen[0];
    expect(first?.props['data-kind']).toBe('string');
    expect(first?.state).toEqual({
      kind: 'string',
      required: false,
      invalid: false,
      disabled: false,
      focused: false,
    });
    const section = document.querySelector('[data-testid="section"]');
    expect(section?.tagName).toBe('SECTION');
    expect(section?.getAttribute('data-kind')).toBe('number');
    expect(section?.querySelector('input')?.getAttribute('type')).toBe(
      'number',
    );
  });

  it('coalesces rapid typing into one undo step', () => {
    const { container, props, store } = renderField('text');
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'He' } });
    fireEvent.change(input, { target: { value: 'Hey' } });
    expect(props().text).toBe('Hey');
    expect(store.getState().history.past.length).toBe(1);
    act(() => {
      store.undo();
    });
    expect(props().text).toBe('Hi');
    expect(input.value).toBe('Hi');
  });
});

// --- Editor.Form ------------------------------------------------------------

describe('Editor.Form', () => {
  function renderForm(blockId: string, disabled?: boolean) {
    const probe: Probe = { store: null };
    const utils = render(
      <Editor.Root schema={formSchema} defaultValue={makeTree()} fields={stubs}>
        <StoreProbe probe={probe} />
        <Editor.Form blockId={blockId} disabled={disabled} data-testid="form" />
      </Editor.Root>,
    );
    return { ...utils, probe };
  }

  it('renders every field of the block in schema order, grouped by group', () => {
    const { getByTestId, container } = renderForm(DEMO);
    const form = getByTestId('form');
    expect(form.getAttribute('data-block-type')).toBe('demo');
    const labels = Array.from(container.querySelectorAll('label'));
    expect(labels.map((label) => label.textContent)).toEqual([
      'Cover',
      'Target',
      'Text',
      'Body',
      'Count',
      'Flag',
      'When',
      'Pick',
      'Tags',
      'Link',
    ]);
    const fieldsets = container.querySelectorAll('fieldset');
    expect(fieldsets.length).toBe(1);
    const meta = fieldsets[0] as HTMLFieldSetElement;
    expect(meta.getAttribute('data-group')).toBe('Meta');
    expect(meta.querySelector('legend')?.textContent).toBe('Meta');
    expect(
      Array.from(meta.querySelectorAll('[data-kind]')).map((el) =>
        el.getAttribute('data-kind'),
      ),
    ).toEqual(['image', 'reference']);
    const direct = Array.from(form.children);
    expect(direct[0]?.tagName).toBe('FIELDSET');
    expect(direct.slice(1).map((el) => el.getAttribute('data-kind'))).toEqual([
      'string',
      'richText',
      'number',
      'boolean',
      'date',
      'select',
      'list',
      'link',
    ]);
    for (const field of Array.from(container.querySelectorAll('[data-kind]'))) {
      const label = field.querySelector('label') as HTMLLabelElement;
      const target = label.getAttribute('for');
      const control = Array.from(field.querySelectorAll('[id]')).find(
        (el) => el.getAttribute('id') === target,
      );
      expect(control).toBeDefined();
    }
  });

  it('renders nothing for an unknown block', () => {
    const { queryByTestId } = renderForm('missing');
    expect(queryByTestId('form')).toBeNull();
  });

  it('disabled reaches every built-in control and every mapped control', () => {
    const { container, getByTestId } = renderForm(DEMO, true);
    const controls = Array.from(
      container.querySelectorAll('input, textarea, select, button'),
    ) as (HTMLInputElement | HTMLButtonElement)[];
    expect(controls.length).toBeGreaterThan(10);
    expect(controls.every((control) => control.disabled)).toBe(true);
    expect((getByTestId('stub-cover') as HTMLInputElement).disabled).toBe(true);
    expect((getByTestId('stub-target') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((getByTestId('stub-link') as HTMLInputElement).disabled).toBe(true);
    expect(
      Array.from(container.querySelectorAll('[data-kind]')).every(
        (field) => field.getAttribute('data-disabled') === '',
      ),
    ).toBe(true);
  });
});

// --- useMissingRequired -----------------------------------------------------

describe('useMissingRequired', () => {
  it('lists empty required properties across the document and keeps identity while nodes are unchanged', () => {
    const probe: Probe = { store: null };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <Editor.Root schema={formSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        {children}
      </Editor.Root>
    );
    const { result, rerender } = renderHook(() => useMissingRequired(), {
      wrapper,
    });
    expect(result.current).toEqual([]);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => {
      probe.store?.select(DEMO);
    });
    expect(result.current).toBe(first);
    act(() => {
      probe.store?.update(ROOT, { title: '' });
    });
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      blockId: ROOT,
      key: 'title',
      blockType: 'root',
      label: 'Title',
    });
    const second = result.current;
    rerender();
    expect(result.current).toBe(second);
  });
});
