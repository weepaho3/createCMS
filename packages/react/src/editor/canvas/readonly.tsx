import type { UseRenderComponentProps } from '../../use-render';

import { useRender } from '../../use-render';

type ReadonlySubtreeState = { editorReadonly: boolean };

export type CanvasReadonlySubtreeProps = UseRenderComponentProps<
  'div',
  ReadonlySubtreeState
>;

/**
 * Wraps an embedded tree that is shown but not edited (a referenced
 * document, a preview of a reusable section). The wrapper is `inert` and
 * `display: contents`; block, field and slot anchors inside it are skipped
 * by measurement, selection, hover rings and drop targets.
 */
export function CanvasReadonlySubtree({
  render,
  style,
  ...rest
}: CanvasReadonlySubtreeProps) {
  return useRender<'div', ReadonlySubtreeState>({
    defaultTagName: 'div',
    props: { ...rest, inert: true, style: { display: 'contents', ...style } },
    render,
    // Rendered as `data-editor-readonly`, the marker the anchor readers skip.
    state: { editorReadonly: true },
  });
}
