import { lazyRichTextAdapter } from '@createcms/react/editor/core';

/** Tiptap for the demos' `richText` fields, loaded on first edit. */
export const demoRichText = lazyRichTextAdapter(() =>
  import('@createcms/react/editor/richtext').then((m) =>
    m.createTiptapAdapter(),
  ),
);
