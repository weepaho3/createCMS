// This folder exists twice, in `@createcms/react` (`editor/core/richtext`)
// and in `@createcms/core` (`core/rich-text`), so neither package depends on
// the other: its shared files import nothing outside it, and a test keeps
// both copies identical.

/** A JSON value. */
export type RichTextJsonValue =
  | null
  | boolean
  | number
  | string
  | RichTextJsonValue[]
  | { [key: string]: RichTextJsonValue };

/** A link target: a document, a URL, an email address or a phone number. */
export type RichTextLinkValue =
  | {
      kind: 'internal';
      rootId: string;
      collection: string;
      fragment?: string;
      query?: string;
    }
  | { kind: 'external'; url: string }
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string };

/** Codes of `validateRichText`. */
export type RichTextIssueCode =
  | 'type'
  | 'richTextNode'
  | 'richTextMark'
  | 'richTextLinkProtocol'
  | 'richTextStructure';

/** One finding of `validateRichText`; `path` points into the value. */
export type RichTextIssue = {
  code: RichTextIssueCode;
  path: (string | number)[];
  params?: Record<string, RichTextJsonValue>;
};

/** A mark on a text node (`bold`, `link`, ...), ProseMirror JSON. */
export type RichTextMark = {
  type: string;
  attrs?: Record<string, RichTextJsonValue>;
};

/** One node of a rich text document, ProseMirror JSON. */
export type RichTextNode = {
  type: string;
  attrs?: Record<string, RichTextJsonValue>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

/**
 * A rich text value: the ProseMirror (Tiptap) JSON of one document.
 *
 * @example
 * const body: RichTextDoc = {
 *   type: 'doc',
 *   content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
 * };
 */
export type RichTextDoc = {
  type: 'doc';
  content?: RichTextNode[];
  schemaVersion?: number;
};

/**
 * What one field allows: mark and node types, and `inline` for a value of
 * at most one paragraph. `doc`, `paragraph` and `text` are always allowed.
 */
export type RichTextSchema = {
  marks: readonly string[];
  nodes: readonly string[];
  inline?: boolean;
};
