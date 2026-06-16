import { defineCollection, defineCollections } from '@createcms/core';

/**
 * A `pages` collection: a typed `root` (page-level fields) plus a set of
 * child `blocks` that make up the page body. This mirrors the Quickstart.
 */
const pages = defineCollection({
  label: 'Pages',
  slug: { enabled: true, root: '/', nested: true },
  root: {
    properties: {
      title: { type: 'string', required: true, label: 'Title' },
    },
  },
  blocks: {
    hero: {
      label: 'Hero',
      properties: {
        headline: { type: 'string', required: true, label: 'Headline' },
      },
    },
    richText: {
      label: 'Rich text',
      properties: {
        content: { type: 'richText', required: true, label: 'Content' },
      },
    },
  },
});

export const collections = defineCollections({ pages });
