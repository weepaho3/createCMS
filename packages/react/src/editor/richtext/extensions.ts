import type { AnyExtension } from '@tiptap/core';

import { mergeAttributes, Node } from '@tiptap/core';
import { Link } from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';

import type { RichTextSchema } from '../core/richtext/types';

import { isSafeUrl } from '../core/richtext/schema';

export type TiptapExtensionOptions = {
  /** The URL an image shows while editing; without it images show their alt text. */
  resolveAsset?: (assetId: string) => string | null;
  placeholder?: string;
};

/** The document node of an `inline` field: exactly one paragraph. */
const InlineDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'paragraph',
});

/** A media library image: `assetId` and `alt`, shown through `resolveAsset`. */
function imageNode(resolveAsset: TiptapExtensionOptions['resolveAsset']) {
  return Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
      return {
        assetId: {
          default: null,
          parseHTML: (el) => el.getAttribute('data-asset-id'),
          renderHTML: (attrs) => ({ 'data-asset-id': attrs.assetId }),
        },
        alt: {
          default: null,
          parseHTML: (el) => el.getAttribute('alt'),
          renderHTML: (attrs) => (attrs.alt ? { alt: attrs.alt } : {}),
        },
      };
    },
    parseHTML() {
      return [{ tag: 'img[data-asset-id]' }];
    },
    renderHTML({ HTMLAttributes, node }) {
      const id = node.attrs.assetId as string | null;
      const src = id && resolveAsset ? resolveAsset(id) : null;
      return [
        'img',
        mergeAttributes(HTMLAttributes, src && isSafeUrl(src) ? { src } : {}),
      ];
    },
  });
}

/**
 * The link mark: an `href` for the browser plus the canonical target in
 * `link` (a `LinkValue`); URLs outside `http`, `https`, `mailto`, `tel`
 * and relative ones are refused.
 */
const RichTextLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      link: {
        default: null,
        parseHTML: () => null,
        renderHTML: () => ({}),
      },
    };
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  HTMLAttributes: { target: null, rel: null, class: null },
  isAllowedUri: (url) => isSafeUrl(url),
});

/**
 * The Tiptap extensions for one field: only the nodes and marks its
 * `RichTextSchema` allows (anything else is dropped on paste, on
 * `setContent` and by shortcuts), one paragraph for `inline` fields, and
 * no editor history (undo runs through the editor store).
 */
export function richTextExtensions(
  schema: RichTextSchema,
  options: TiptapExtensionOptions = {},
): AnyExtension[] {
  const nodes = new Set(schema.nodes);
  const marks = new Set(schema.marks);
  const inline = schema.inline === true;
  const block = (name: string) => !inline && nodes.has(name);
  const off = <T>(on: boolean, value: T): T | false => (on ? value : false);
  const extensions: AnyExtension[] = [
    StarterKit.configure({
      document: inline ? false : undefined,
      undoRedo: false,
      trailingNode: false,
      link: false,
      bold: off(marks.has('bold'), {}),
      italic: off(marks.has('italic'), {}),
      underline: off(marks.has('underline'), {}),
      strike: off(marks.has('strike'), {}),
      code: off(marks.has('code'), {}),
      heading: off(block('heading'), { levels: [1, 2, 3, 4, 5, 6] }),
      bulletList: off(block('bulletList') && nodes.has('listItem'), {}),
      orderedList: off(block('orderedList') && nodes.has('listItem'), {}),
      listItem: off(
        nodes.has('listItem') && (block('bulletList') || block('orderedList')),
        {},
      ),
      listKeymap: off(
        nodes.has('listItem') && (block('bulletList') || block('orderedList')),
        {},
      ),
      blockquote: off(block('blockquote'), {}),
      codeBlock: off(block('codeBlock'), {}),
      horizontalRule: off(block('horizontalRule'), {}),
      hardBreak: off(nodes.has('hardBreak'), {}),
      dropcursor: off(!inline, {}),
      gapcursor: inline ? false : undefined,
    }),
  ];
  if (inline) extensions.push(InlineDocument);
  if (marks.has('link')) extensions.push(RichTextLink);
  if (block('image')) extensions.push(imageNode(options.resolveAsset));
  if (options.placeholder) {
    extensions.push(
      Placeholder.configure({ placeholder: options.placeholder }),
    );
  }
  return extensions;
}
