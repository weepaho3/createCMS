import { describe, expect, it, vi } from 'vitest';

import type { StandardSchemaV1 } from './schema';

import {
  applyPlugins,
  defineEditorPlugin,
  normalizeCombo,
  sortPlugins,
} from './plugin';
import { defineEditorSchema } from './schema';
import { createEditorStore } from './store';

const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: {
    icon: {
      label: 'Icon',
      fields: { glyph: { type: 'custom', kind: 'icon' } },
    },
  },
});

const doc = {
  schemaVersion: 1,
  root: { id: 'r', type: 'root', props: {}, slots: { children: [] } },
};

const onlyStar: StandardSchemaV1 = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value) =>
      value === 'star' ? { value } : { issues: [{ message: 'not a star' }] },
  },
};

describe('plugins', () => {
  it('orders by descending priority, stable; duplicate names throw', () => {
    const a = defineEditorPlugin({ name: 'a' });
    const b = defineEditorPlugin({ name: 'b', priority: 5 });
    const c = defineEditorPlugin({ name: 'c' });
    expect(sortPlugins([a, b, c]).map((p) => p.name)).toEqual(['b', 'a', 'c']);
    expect(() => sortPlugins([a, a])).toThrow(/duplicate plugin name "a"/);
  });

  it('adds blocks (schema wins) and field kind validators', () => {
    const applied = applyPlugins(schema, [
      defineEditorPlugin({
        name: 'icons',
        fields: { icon: { validate: onlyStar } },
        blocks: {
          badge: { label: 'Badge', fields: {} },
          icon: { label: 'Ignored', fields: {} },
        },
      }),
    ]);
    expect(Object.keys(applied.components)).toEqual(['badge', 'icon']);
    expect(applied.components.icon?.label).toBe('Icon');
    const glyph = applied.components.icon?.fields.glyph;
    expect(glyph?.type === 'custom' && glyph.schema).toBe(onlyStar);
    expect(applyPlugins(schema, [])).toBe(schema);
  });

  it('registers commands, shortcuts and event handlers on the store', () => {
    const changes = vi.fn();
    const store = createEditorStore({
      schema,
      initialValue: doc,
      plugins: [
        defineEditorPlugin({
          name: 'icons',
          commands: {
            'icon.add': {
              label: 'Add icon',
              run: (s) => s.add('icon', { parent: { id: 'r' } }),
            },
          },
          shortcuts: { 'Shift+Mod+I': 'icon.add' },
          on: { change: changes },
        }),
      ],
    });
    expect(store.commands.shortcuts()['mod+shift+i']).toBe('icon.add');
    store.commands.execute('icon.add');
    expect(store.getDoc().nodes.r?.slots.children).toHaveLength(1);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('beforeCommand from a plugin can veto', () => {
    const store = createEditorStore({
      schema,
      initialValue: doc,
      plugins: [
        defineEditorPlugin({
          name: 'readonly',
          on: { beforeCommand: () => false },
        }),
      ],
    });
    expect(store.add('icon', { parent: { id: 'r' } })).toBeNull();
  });

  it('reports a shortcut bound twice and keeps the first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = createEditorStore({
      schema,
      initialValue: doc,
      plugins: [
        defineEditorPlugin({ name: 'a', shortcuts: { 'Mod+k': 'a.run' } }),
        defineEditorPlugin({ name: 'b', shortcuts: { 'mod+K': 'b.run' } }),
      ],
    });
    expect(store.commands.shortcuts()['mod+k']).toBe('a.run');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[editor:E003]'));
    warn.mockRestore();
  });

  it('normalizes combos', () => {
    expect(normalizeCombo('Shift+Cmd+Z')).toBe('mod+shift+z');
    expect(normalizeCombo('ctrl+alt+K')).toBe('ctrl+alt+k');
  });
});
