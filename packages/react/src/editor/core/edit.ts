/**
 * The anchor attributes an editor surface reads back from the DOM: the block
 * an element belongs to, the field it shows, the slot it holds. Spread onto
 * an element; absent entries never reach the HTML.
 */
export type EditAttrs = {
  readonly 'data-editor-block'?: string;
  readonly 'data-editor-field'?: string;
  readonly 'data-editor-slot'?: string;
};

/**
 * A callback ref the canvas may hand a block. Callback form only: it can be
 * spread onto any element, which an object ref typed for `Element` cannot.
 */
export type EditRef = (el: Element | null) => void;

/**
 * Editor anchors handed to a component as plain data. Spread `block` on the
 * component's root element, `field.<key>` on the element that shows that
 * field and `slot.<name>` on the element that holds that slot's children.
 * Outside an editor every entry is empty, so the spreads are no-ops.
 */
export type EditProps<
  TFields extends Record<string, unknown> = Record<string, unknown>,
  TSlots extends Record<string, unknown> = Record<string, unknown>,
> = {
  /** `true` only inside an interactive editor canvas. */
  readonly active: boolean;
  readonly block: EditAttrs & { readonly ref?: EditRef };
  readonly field: { readonly [K in keyof TFields]?: EditAttrs };
  readonly slot?: { readonly [K in keyof TSlots]?: EditAttrs };
};

/** The anchors outside an editor: inactive and empty. */
export const NO_EDIT: EditProps = Object.freeze({
  active: false,
  block: Object.freeze({}),
  field: Object.freeze({}),
});
