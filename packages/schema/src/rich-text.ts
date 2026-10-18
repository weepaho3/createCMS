// The stored form of a `richText` property: ProseMirror (Tiptap) JSON. The
// same shape is the `RichTextDoc` of `@createcms/core` and of
// `@createcms/react/editor/core`; type tests keep the three equal.

type RichTextJsonValue =
  | null
  | boolean
  | number
  | string
  | RichTextJsonValue[]
  | { [key: string]: RichTextJsonValue };

/** A mark on a text node (`bold`, `link`, ...). */
export type RichTextMark = {
  type: string;
  attrs?: Record<string, RichTextJsonValue>;
};

/** One node of a rich text document. */
export type RichTextNode = {
  type: string;
  attrs?: Record<string, RichTextJsonValue>;
  content?: RichTextNode[];
  marks?: RichTextMark[];
  text?: string;
};

/** A `richText` value: `{ type: 'doc', content: [...] }`. */
export type RichTextDoc = {
  type: 'doc';
  content?: RichTextNode[];
  schemaVersion?: number;
};
