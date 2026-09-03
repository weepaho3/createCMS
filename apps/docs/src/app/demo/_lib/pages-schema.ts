import { defineBlock, defineCollection } from '@createcms/core';

const hero = defineBlock({
  label: 'Hero',
  group: 'Layout',
  properties: {
    headline: { type: 'string', label: 'Headline', required: true },
    image: { type: 'image', label: 'Image' },
  },
});

const featuresGrid = defineBlock({
  label: 'Features',
  group: 'Layout',
  allowChildren: true,
  properties: {},
});

const featureItem = defineBlock({
  label: 'Feature',
  group: 'Layout',
  properties: {
    title: { type: 'string', label: 'Title', required: true },
    body: { type: 'string', label: 'Body', description: 'Short feature copy.' },
  },
});

const image = defineBlock({
  label: 'Image',
  group: 'Media',
  properties: {
    src: { type: 'image', label: 'Source', required: true },
    alt: { type: 'string', label: 'Alt text' },
  },
});

const richText = defineBlock({
  label: 'Rich text',
  group: 'Content',
  properties: {
    text: { type: 'richText', label: 'Text', required: true },
  },
});

export const pages = defineCollection({
  label: 'Pages',
  slug: { enabled: true, prefix: '/pages' },
  root: {
    properties: {
      title: { type: 'string', label: 'Title', required: true },
      excerpt: {
        type: 'string',
        label: 'Excerpt',
        description: 'Longer summary shown in listings.',
      },
      featured: {
        type: 'boolean',
        label: 'Featured',
        description: 'Show this page on the home page.',
      },
      status: {
        type: 'select',
        label: 'Status',
        options: [
          { label: 'Draft', value: 'draft' },
          { label: 'Published', value: 'published' },
        ],
      },
      sortOrder: {
        type: 'number',
        label: 'Sort order',
        description: 'Lower numbers appear first.',
      },
    },
  },
  blocks: { hero, featuresGrid, featureItem, image, richText },
  structure: {
    root: { accepts: ['hero', 'featuresGrid', 'image', 'richText'] },
    featuresGrid: { accepts: ['featureItem'] },
  },
});
