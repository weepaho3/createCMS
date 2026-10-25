import type { BlockProperty } from './properties';

/**
 * The anchor attributes an editor surface reads back from the DOM: which
 * block an element belongs to, which property it shows and which slot it
 * holds. Spread onto an element; absent entries never reach the HTML.
 */
export type EditAttrs = {
  readonly 'data-editor-block'?: string;
  readonly 'data-editor-field'?: string;
  readonly 'data-editor-slot'?: string;
};

/**
 * Editor anchors handed to a block component as PLAIN DATA: no functions, so
 * the object crosses the server -> client component boundary. `TProps` is the
 * `properties` object of the block DEFINITION, so `field` has one entry per
 * declared property whatever the value type. Spread `block` on the block's
 * root element, `field.<key>` on the element that shows that property and
 * `slot.children` on the element that holds the block's children. Outside an
 * editor every entry is absent (`{}`), so `{...edit.field.title}` is a no-op
 * there. Structurally equal to `EditProps` of `@createcms/react/editor/core`.
 */
export type EditProps<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
> = {
  /** `true` only inside an interactive editor canvas. */
  readonly active: boolean;
  readonly block: EditAttrs;
  readonly field: { readonly [K in keyof TProps]?: EditAttrs };
  readonly slot?: { readonly [name: string]: EditAttrs | undefined };
};
