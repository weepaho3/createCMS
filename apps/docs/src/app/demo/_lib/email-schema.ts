import { defineBlock, defineCollection } from '@createcms/core';

const heading = defineBlock({
  label: 'Heading',
  group: 'Content',
  properties: {
    text: { type: 'string', label: 'Text', required: true },
  },
});

const paragraph = defineBlock({
  label: 'Paragraph',
  group: 'Content',
  properties: {
    text: { type: 'richText', label: 'Text', required: true },
  },
});

const button = defineBlock({
  label: 'Button',
  group: 'Content',
  properties: {
    label: { type: 'string', label: 'Label', required: true },
    href: { type: 'string', label: 'Link', required: true },
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

export const emails = defineCollection({
  label: 'Emails',
  slug: { enabled: false },
  root: {
    properties: {
      subject: { type: 'string', label: 'Subject', required: true },
    },
  },
  blocks: { heading, paragraph, button, image },
  structure: {
    root: { accepts: ['heading', 'paragraph', 'button', 'image'] },
  },
});
