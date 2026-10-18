import type { JSONContent } from '@tiptap/core';

import { Editor } from '@tiptap/core';

import type {
  RichTextAdapter,
  RichTextCommands,
  RichTextHandle,
  RichTextMountOptions,
} from '../core/richtext/adapter';
import type { ParsedHtmlDocument } from '../core/richtext/parse-html';
import type {
  RichTextDoc,
  RichTextJsonValue,
  RichTextNode,
} from '../core/richtext/types';
import type { TiptapExtensionOptions } from './extensions';

import { htmlToRichText } from '../core/richtext/parse-html';
import { linkMarkHref } from '../core/richtext/schema';
import { richTextExtensions } from './extensions';
import { suggestionExtension } from './suggestion';

/** Tiptap attributes that only carry rendering defaults. */
const DROPPED_ATTRS = new Set(['rel', 'class']);

function cleanAttrs(
  attrs: Record<string, unknown> | undefined,
): Record<string, RichTextJsonValue> | undefined {
  if (!attrs) return undefined;
  const out: Record<string, RichTextJsonValue> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || DROPPED_ATTRS.has(key)) {
      continue;
    }
    out[key] = value as RichTextJsonValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanNode(node: JSONContent): RichTextNode {
  const out: RichTextNode = { type: node.type ?? 'paragraph' };
  const attrs = cleanAttrs(node.attrs);
  if (attrs) out.attrs = attrs;
  if (node.text !== undefined) out.text = node.text;
  if (node.marks && node.marks.length > 0) {
    out.marks = node.marks.map((mark) => {
      const markAttrs = cleanAttrs(mark.attrs);
      return markAttrs
        ? { type: mark.type, attrs: markAttrs }
        : { type: mark.type };
    });
  }
  if (node.content && node.content.length > 0) {
    out.content = node.content.map(cleanNode);
  }
  return out;
}

/**
 * Tiptap's JSON without its rendering defaults (null attributes, `rel`,
 * `class`), so an unchanged value round-trips unchanged.
 */
export function fromTiptapJson(json: JSONContent): RichTextDoc {
  return {
    type: 'doc',
    content: (json.content ?? []).map(cleanNode),
  };
}

function commandsOf(editor: Editor): RichTextCommands {
  return {
    toggleMark: (name) => {
      editor.chain().focus().toggleMark(name).run();
    },
    setLink: (value) => {
      const chain = editor.chain().focus().extendMarkRange('link');
      if (value === null) {
        chain.unsetMark('link').run();
        return;
      }
      if ('href' in value && !('kind' in value)) {
        chain.setMark('link', { href: value.href, link: null }).run();
        return;
      }
      chain
        .setMark('link', {
          link: value,
          href: linkMarkHref({ link: value as RichTextJsonValue }),
        })
        .run();
    },
    setNode: (type, attrs) => {
      const chain = editor.chain().focus();
      switch (type) {
        case 'bulletList':
          chain.toggleBulletList().run();
          return;
        case 'orderedList':
          chain.toggleOrderedList().run();
          return;
        case 'blockquote':
          chain.toggleBlockquote().run();
          return;
        case 'codeBlock':
          chain.toggleCodeBlock().run();
          return;
        case 'horizontalRule':
          chain.setHorizontalRule().run();
          return;
        default:
          chain.setNode(type, attrs).run();
      }
    },
    isActive: (name, attrs) => editor.isActive(name, attrs),
  };
}

/**
 * Mounts a Tiptap editor for one field. Paste goes through
 * `htmlToRichText`, so Office and Google Docs markup is cleaned the same
 * way as on import and the field's schema decides what stays.
 */
function mount(
  el: HTMLElement,
  options: RichTextMountOptions,
  extensionOptions: TiptapExtensionOptions,
): RichTextHandle {
  const view = el.ownerDocument.defaultView;
  const parse = (html: string): ParsedHtmlDocument => {
    const Parser = view?.DOMParser;
    if (!Parser) return { body: null };
    return new Parser().parseFromString(html, 'text/html');
  };
  const attributes: Record<string, string> = {
    role: 'textbox',
    'aria-multiline': options.schema.inline ? 'false' : 'true',
    ...options.attributes,
  };
  const extensions = richTextExtensions(options.schema, {
    ...extensionOptions,
    placeholder: options.placeholder ?? extensionOptions.placeholder,
  });
  if (options.suggestion) {
    extensions.push(suggestionExtension(options.suggestion));
  }
  const editor = new Editor({
    element: el,
    extensions,
    content: options.value as JSONContent,
    editable: options.editable ?? true,
    injectCSS: false,
    editorProps: {
      attributes,
      handlePaste: (_view, event) => {
        const html = event.clipboardData?.getData('text/html');
        if (!html) return false;
        const { doc } = htmlToRichText(html, options.schema, {
          domParser: parse,
        });
        const content = options.schema.inline
          ? (doc.content?.[0]?.content ?? [])
          : (doc.content ?? []);
        editor.commands.insertContent(content as JSONContent[]);
        return true;
      },
    },
    onUpdate: ({ editor: current }) => {
      options.onChange(fromTiptapJson(current.getJSON()));
    },
    onSelectionUpdate: () => options.onSelectionChange?.(),
    onTransaction: () => options.onSelectionChange?.(),
    onFocus: () => options.onFocus?.(),
    onBlur: () => options.onBlur?.(),
  });

  if (options.caretFrom) {
    const at = editor.view.posAtCoords({
      left: options.caretFrom.x,
      top: options.caretFrom.y,
    });
    editor.commands.focus(at ? at.pos : 'end');
  }

  return {
    setValue: (value) => {
      editor.commands.setContent(value as JSONContent, { emitUpdate: false });
    },
    setEditable: (editable) => {
      if (editor.isEditable !== editable) editor.setEditable(editable, false);
    },
    focus: () => {
      editor.commands.focus();
    },
    destroy: () => editor.destroy(),
    commands: commandsOf(editor),
  };
}

/**
 * The Tiptap rich text editor for `Editor.Root richText`. Import this
 * subpath lazily (`lazyRichTextAdapter(() => import(...))`) so Tiptap
 * stays out of the initial bundle.
 *
 * @example
 * import { createTiptapAdapter } from '@createcms/react/editor/richtext';
 * <Editor.Root richText={createTiptapAdapter()} ... />
 */
export function createTiptapAdapter(
  options: TiptapExtensionOptions = {},
): RichTextAdapter {
  return { mount: (el, mountOptions) => mount(el, mountOptions, options) };
}
