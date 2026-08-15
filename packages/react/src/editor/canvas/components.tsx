import * as React from 'react';

import { useEditorContext } from '../context';

export type CanvasRootProps = React.ComponentPropsWithRef<'div'>;

/**
 * Placeholder surface: a plain `div` that shares the editor context with
 * `/editor` and reserves the part name.
 */
export function CanvasRoot(props: CanvasRootProps) {
  useEditorContext('Canvas.Root');
  return <div data-editor-canvas="" {...props} />;
}
