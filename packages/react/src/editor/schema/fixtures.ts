import type { CollectionDefinition } from '@createcms/schema';

/** A small but representative schema: every field kind, groups, constraints, all structure modes. */
export const pages = {
  label: 'Pages',
  root: {
    properties: {
      title: {
        type: 'string',
        label: 'Title',
        required: true,
        group: 'Content',
      },
      slugHint: { type: 'string', label: 'Slug hint', group: 'SEO' },
      publishedAt: { type: 'date', label: 'Published at' },
    },
  },
  blocks: {
    heading: {
      label: 'Heading',
      group: 'Text',
      properties: {
        text: { type: 'string', label: 'Text', minLength: 2, maxLength: 10 },
        level: {
          type: 'number',
          label: 'Level',
          defaultValue: 2,
          min: 1,
          max: 6,
        },
      },
    },
    paragraph: {
      label: 'Paragraph',
      description: 'A block of body text',
      group: 'Text',
      properties: {
        text: { type: 'richText', label: 'Body', pattern: '^[A-Z]' },
      },
    },
    image: {
      label: 'Image',
      properties: {
        url: { type: 'image', label: 'Image', required: true },
        alt: { type: 'string', label: 'Alt text', defaultValue: '' },
      },
    },
    cta: {
      label: 'Call to action',
      group: 'Marketing',
      previewImageUrl: '/previews/cta.png',
      properties: {
        variant: {
          type: 'select',
          label: 'Variant',
          options: [
            { label: 'Solid', value: 'solid' },
            { label: 'Ghost', value: 'ghost' },
          ],
        },
        enabled: { type: 'boolean', label: 'Enabled' },
        target: { type: 'reference', label: 'Target', collection: 'pages' },
        link: {
          type: 'link',
          label: 'Link',
          required: true,
          allowedKinds: ['internal', 'external'],
          allowedCollections: ['pages'],
        },
        tags: {
          type: 'list',
          label: 'Tags',
          of: { type: 'string', minLength: 1 },
          min: 1,
          max: 3,
        },
        sizes: {
          type: 'list',
          label: 'Sizes',
          of: {
            type: 'select',
            options: [
              { label: 'S', value: 's' },
              { label: 'M', value: 'm' },
            ],
          },
        },
      },
    },
    section: {
      label: 'Section',
      allowChildren: true,
      properties: { title: { type: 'string', label: 'Title' } },
    },
    freeContainer: {
      label: 'Free container',
      allowChildren: true,
      properties: {},
    },
    sealed: {
      label: 'Sealed container',
      allowChildren: true,
      properties: {},
    },
    noChildrenFlag: {
      label: 'Container-like without the flag',
      properties: {},
    },
  },
  structure: {
    section: { accepts: ['heading', 'paragraph'] },
    root: { excludes: ['heading'] },
    sealed: { accepts: [] },
    freeContainer: { accepts: '*' },
    noChildrenFlag: { accepts: ['heading'] },
  },
} satisfies CollectionDefinition;
