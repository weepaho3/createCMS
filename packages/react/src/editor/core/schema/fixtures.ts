import { defineEditorSchema } from './types';

/** A small but representative schema: every field kind, groups, constraints, all slot modes. */
export const pages = defineEditorSchema({
  root: {
    label: 'Page',
    fields: {
      title: {
        type: 'text',
        label: 'Title',
        required: true,
        group: 'Content',
      },
      slugHint: { type: 'text', label: 'Slug hint', group: 'SEO' },
      publishedAt: { type: 'date', label: 'Published at' },
    },
    slots: { children: { disallow: ['heading'] } },
  },
  components: {
    heading: {
      label: 'Heading',
      category: 'Text',
      fields: {
        text: { type: 'text', label: 'Text', minLength: 2, maxLength: 10 },
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
      category: 'Text',
      fields: {
        text: { type: 'richText', label: 'Body', pattern: '^[A-Z]' },
      },
    },
    image: {
      label: 'Image',
      icon: 'image',
      fields: {
        url: { type: 'media', label: 'Image', required: true },
        alt: { type: 'text', label: 'Alt text', defaultValue: '' },
      },
    },
    cta: {
      label: 'Call to action',
      category: 'Marketing',
      previewImageUrl: '/previews/cta.png',
      fields: {
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
          of: { type: 'text', minLength: 1 },
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
    card: {
      label: 'Card',
      fields: {
        summary: { type: 'textarea', label: 'Summary', maxLength: 140 },
        accent: { type: 'color', label: 'Accent' },
        columns: { type: 'number', label: 'Columns', min: 1, step: 1 },
        flags: {
          type: 'select',
          label: 'Flags',
          multiple: true,
          options: [
            { label: 'New', value: 'new' },
            { label: 'Hot', value: 'hot' },
          ],
        },
        cta: {
          type: 'object',
          label: 'CTA',
          fields: {
            label: { type: 'text', label: 'Label', required: true },
            href: { type: 'text', label: 'Href' },
          },
        },
        icon: { type: 'custom', kind: 'icon-picker', label: 'Icon' },
      },
    },
    section: {
      label: 'Section',
      fields: { title: { type: 'text', label: 'Title' } },
      slots: { children: { allow: ['heading', 'paragraph'] } },
    },
    freeContainer: {
      label: 'Free container',
      fields: {},
      slots: { children: {} },
    },
    sealed: {
      label: 'Sealed container',
      fields: {},
      slots: { children: { allow: [] } },
    },
    noSlot: {
      label: 'Component without a children slot',
      fields: {},
    },
    hidden: {
      label: 'Not insertable',
      fields: {},
      permissions: { insert: false },
    },
  },
});
