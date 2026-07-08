import { defineCollection, defineCollections } from '@createcms/core';

/**
 * A `posts` collection. The `root` holds post-level fields (shown in listings);
 * the `blocks` make up the post body. Posts live under `/blog`, one level deep
 * (`nested: false`), so a post's full path is `/blog/<slug>`.
 */
const posts = defineCollection({
  label: 'Posts',
  slug: { enabled: true, prefix: '/blog', nested: false },
  root: {
    properties: {
      title: { type: 'string', required: true, label: 'Title' },
      excerpt: { type: 'string', label: 'Excerpt' },
      publishedAt: { type: 'date', label: 'Published at' },
    },
  },
  blocks: {
    richText: {
      label: 'Rich text',
      properties: {
        content: { type: 'richText', required: true, label: 'Body' },
      },
    },
    quote: {
      label: 'Quote',
      properties: {
        text: { type: 'string', required: true, label: 'Quote' },
        cite: { type: 'string', label: 'Attribution' },
      },
    },
  },
});

export const collections = defineCollections({ posts });
