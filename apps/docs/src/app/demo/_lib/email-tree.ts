import type { BlockTreeNode } from '@createcms/core';

export const EMAIL_TREE: BlockTreeNode = {
  blockId: 'root',
  type: 'root',
  properties: {
    subject: 'createCMS email demo',
  },
  children: [
    {
      blockId: 'heading-1',
      type: 'heading',
      properties: {
        text: 'Hello from createCMS',
      },
      children: [],
    },
    {
      blockId: 'paragraph-1',
      type: 'paragraph',
      properties: {
        text: '<p>This email is rendered with react-email and BlocksRenderer.</p>',
      },
      children: [],
    },
    {
      blockId: 'button-1',
      type: 'button',
      properties: {
        label: 'Read the docs',
        href: 'https://createcms.dev/docs',
      },
      children: [],
    },
    {
      blockId: 'image-1',
      type: 'image',
      properties: {
        src: 'hero',
        alt: 'Hero image',
      },
      children: [],
    },
  ],
};
