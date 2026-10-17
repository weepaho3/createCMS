import type { BlockTreeNode, CollectionDefinition } from '@createcms/schema';

/** A createcms collection: open root, a whitelist section, declared defaults, a required image. */
export const cmsSchema = {
  label: 'Pages',
  root: {
    properties: { title: { type: 'string', label: 'Title', required: true } },
  },
  blocks: {
    heading: {
      label: 'Heading',
      properties: {
        text: { type: 'string', label: 'Text' },
        level: { type: 'number', label: 'Level', defaultValue: 2 },
      },
    },
    paragraph: {
      label: 'Paragraph',
      properties: { text: { type: 'richText', label: 'Body' } },
    },
    image: {
      label: 'Image',
      properties: {
        url: { type: 'image', label: 'Image', required: true },
        alt: { type: 'string', label: 'Alt', defaultValue: '' },
      },
    },
    section: {
      label: 'Section',
      allowChildren: true,
      properties: { title: { type: 'string', label: 'Title' } },
    },
  },
  structure: { section: { accepts: ['heading', 'paragraph'] } },
} satisfies CollectionDefinition;

/** A raw `getBlockTree` tree; the root carries an undeclared `__slug`. */
export function makeCmsTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: { title: 'Home', __slug: 'home' },
    children: [
      {
        blockId: 'h1',
        type: 'heading',
        properties: { text: 'Hello', level: 1 },
        children: [],
      },
      {
        blockId: 'sec1',
        type: 'section',
        properties: { title: 'Sec' },
        children: [
          {
            blockId: 'p1',
            type: 'paragraph',
            properties: { text: 'World' },
            children: [],
          },
        ],
      },
    ],
  };
}
