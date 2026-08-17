import type { BlockTreeNode } from '@createcms/core';

export const PAGES_TREE: BlockTreeNode = {
  blockId: 'root',
  type: 'root',
  properties: {
    title: 'Demo page',
  },
  children: [
    {
      blockId: 'hero-1',
      type: 'hero',
      properties: {
        headline: 'Welcome to the editor demo',
        image: 'hero',
      },
      children: [],
    },
    {
      blockId: 'grid-1',
      type: 'featuresGrid',
      properties: {},
      children: [
        {
          blockId: 'feat-1',
          type: 'featureItem',
          properties: {
            title: 'Live canvas',
            body: 'Edit blocks directly on the page.',
          },
          children: [],
        },
        {
          blockId: 'feat-2',
          type: 'featureItem',
          properties: {
            title: 'Registry chrome',
            body: 'Shell, form, and canvas from the docs registry.',
          },
          children: [],
        },
      ],
    },
    {
      blockId: 'rt-1',
      type: 'richText',
      properties: {
        text: '<p>Hello from the demo.</p>',
      },
      children: [],
    },
    {
      blockId: 'img-1',
      type: 'image',
      properties: {
        src: 'feature',
        alt: 'Feature illustration',
      },
      children: [],
    },
  ],
};
