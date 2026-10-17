import { describe, expect, it } from 'vitest';

import type { ContextNode } from './visibility';

import { defineEditorSchema } from './types';
import {
  createFieldResolver,
  fieldContextFor,
  isFieldVisible,
  resolveFields,
} from './visibility';

const ctx = {
  nodeId: 'n1',
  type: 'hero',
  context: {},
  metadata: {},
};

describe('isFieldVisible', () => {
  it('hidden: true hides, a predicate hides when it returns true', () => {
    expect(isFieldVisible({ type: 'text', hidden: true }, {}, ctx)).toBe(false);
    const field = {
      type: 'text' as const,
      hidden: (props: Record<string, unknown>) => props.mode === 'simple',
    };
    expect(isFieldVisible(field, { mode: 'simple' }, ctx)).toBe(false);
    expect(isFieldVisible(field, { mode: 'full' }, ctx)).toBe(true);
  });

  it('when shows the field only while the other prop equals eq', () => {
    const field = {
      type: 'media' as const,
      when: { field: 'variant', eq: 'image' },
    };
    expect(isFieldVisible(field, { variant: 'image' }, ctx)).toBe(true);
    expect(isFieldVisible(field, { variant: 'text' }, ctx)).toBe(false);
    expect(isFieldVisible(field, {}, ctx)).toBe(false);
  });

  it('when compares JSON values structurally', () => {
    const field = { type: 'text' as const, when: { field: 'pos', eq: [1, 2] } };
    expect(isFieldVisible(field, { pos: [1, 2] }, ctx)).toBe(true);
  });
});

describe('resolveFields', () => {
  const def = {
    label: 'Hero',
    fields: {
      title: { type: 'text' as const, label: 'Title' },
      size: { type: 'number' as const },
    },
    resolveFields: (data: { props: { title?: string } }) =>
      data.props.title === 'locked'
        ? { title: { readOnly: true }, size: { max: 3 } }
        : {},
  };

  it('merges overrides over the declared fields', () => {
    const fields = resolveFields(def, { title: 'locked' }, ctx);
    expect(fields.title).toEqual({
      type: 'text',
      label: 'Title',
      readOnly: true,
    });
    expect(fields.size).toEqual({ type: 'number', max: 3 });
  });

  it('returns the declared fields without resolveFields', () => {
    const plain = { label: 'P', fields: { a: { type: 'text' as const } } };
    expect(resolveFields(plain, {}, ctx)).toBe(plain.fields);
  });

  it('createFieldResolver memoises per props object and filters hidden fields', () => {
    let calls = 0;
    const counted = {
      ...def,
      fields: {
        ...def.fields,
        secret: { type: 'text' as const, hidden: true },
      },
      resolveFields: (data: { props: { title?: string } }) => {
        calls += 1;
        return def.resolveFields(data);
      },
    };
    const resolve = createFieldResolver();
    const props = { title: 'x' };
    const first = resolve(counted, props, ctx);
    const second = resolve(counted, props, { ...ctx, context: {} });
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(Object.keys(first)).toEqual(['title', 'size']);
    resolve(counted, { title: 'x' }, ctx);
    expect(calls).toBe(2);
  });
});

describe('fieldContextFor', () => {
  const schema = defineEditorSchema({
    root: {
      label: 'Root',
      fields: { theme: { type: 'text' } },
      slots: { children: {} },
      providesContext: { theme: 'theme' },
    },
    components: {
      section: {
        label: 'Section',
        fields: { tone: { type: 'text' }, theme: { type: 'text' } },
        slots: { children: {} },
        providesContext: { tone: 'tone', theme: 'theme' },
      },
      text: { label: 'Text', fields: {}, usesContext: ['theme'] },
      any: { label: 'Any', fields: {} },
    },
    metadata: { locale: 'de' },
  });
  const nodes: Record<string, ContextNode> = {
    root: { type: 'root', parent: null, props: { theme: 'dark' } },
    s1: {
      type: 'section',
      parent: { id: 'root' },
      props: { tone: 'loud', theme: 'light' },
    },
    t1: { type: 'text', parent: { id: 's1' }, props: {} },
    a1: { type: 'any', parent: { id: 's1' }, props: {} },
  };
  const get = (id: string) => nodes[id];

  it('nearest ancestor wins and usesContext filters', () => {
    expect(fieldContextFor(schema, get, 't1')).toEqual({
      nodeId: 't1',
      type: 'text',
      context: { theme: 'light' },
      metadata: { locale: 'de' },
    });
  });

  it('without usesContext every provided value is visible', () => {
    expect(fieldContextFor(schema, get, 'a1').context).toEqual({
      tone: 'loud',
      theme: 'light',
    });
  });
});
