// @createcms/react/editor/richtext: the Tiptap rich text editor. Tiptap is an
// optional peer dependency; this is the only subpath that imports it.

export type { TiptapExtensionOptions } from './extensions';
export { richTextExtensions } from './extensions';
export { createTiptapAdapter, fromTiptapJson } from './adapter';
