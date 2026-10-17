import type { EditorDocument, FlatNode } from '../document';
import type { EditorNodes } from './serde';

import { defineEditorSchema } from '../schema';

/** Schema for the store tests: open root, a whitelist section, declared defaults, a required image. */
export const storeSchema = defineEditorSchema({
  root: {
    label: 'Page',
    fields: { title: { type: 'text', label: 'Title', required: true } },
    slots: { children: {} },
  },
  components: {
    heading: {
      label: 'Heading',
      fields: {
        text: { type: 'text', label: 'Text' },
        level: { type: 'number', label: 'Level', defaultValue: 2 },
      },
    },
    paragraph: {
      label: 'Paragraph',
      fields: { text: { type: 'richText', label: 'Body' } },
    },
    image: {
      label: 'Image',
      fields: {
        url: { type: 'media', label: 'Image', required: true },
        alt: { type: 'text', label: 'Alt', defaultValue: '' },
      },
    },
    section: {
      label: 'Section',
      fields: { title: { type: 'text', label: 'Title' } },
      slots: { children: { allow: ['heading', 'paragraph'] } },
    },
  },
});

/** Fresh document per call; the root carries an undeclared `__slug` prop. */
export function makeDoc(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: { title: 'Home', __slug: 'home' },
      slots: {
        children: [
          {
            id: 'h1',
            type: 'heading',
            props: { text: 'Hello', level: 1 },
          },
          {
            id: 'sec1',
            type: 'section',
            props: { title: 'Sec' },
            slots: {
              children: [
                { id: 'p1', type: 'paragraph', props: { text: 'World' } },
              ],
            },
          },
        ],
      },
    },
  };
}

/** Deterministic id generator: n1, n2, … */
export function counterGenId(): () => string {
  let i = 0;
  return () => `n${++i}`;
}

/** Controllable clock for coalescing tests. */
export function fakeClock(start = 1_000): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

/**
 * A node table from a compact outline: `parentId` and `childIds` refer to the
 * `children` slot. Props are empty.
 */
export function flatNodes(
  entries: Record<
    string,
    { type: string; parentId: string | null; childIds: string[] }
  >,
): EditorNodes {
  const out: Record<string, FlatNode> = {};
  for (const [id, node] of Object.entries(entries)) {
    out[id] = {
      id,
      type: node.type,
      props: {},
      parent:
        node.parentId === null ? null : { id: node.parentId, slot: 'children' },
      slots: { children: [...node.childIds] },
    };
  }
  return out;
}
