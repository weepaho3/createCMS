import type { BlockProperty } from './properties';

/**
 * The anchor attributes an editor surface reads back from the DOM: which
 * block an element belongs to and which property it shows. Spread onto an
 * element; when both are absent nothing reaches the HTML.
 */
export type EditAttrs = {
  readonly 'data-editor-block'?: string;
  readonly 'data-editor-field'?: string;
};

/**
 * Editor anchors handed to a block component as PLAIN DATA — no functions, so
 * the object crosses the server → client component boundary. `TProps` is the
 * `properties` object of the block DEFINITION, so `field` has one entry per
 * declared property whatever the value type. Spread `block` on the block's
 * root element and `field.<key>` on the element that shows that property.
 * Outside an editor every entry is absent (`{}`), so `{...edit.field.title}`
 * is a no-op there.
 */
export type EditProps<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
> = {
  /** `true` only inside an interactive editor canvas. */
  readonly active: boolean;
  readonly block: EditAttrs;
  readonly field: { readonly [K in keyof TProps]?: EditAttrs };
};
