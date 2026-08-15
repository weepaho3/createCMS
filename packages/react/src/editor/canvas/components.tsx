import * as React from 'react';

import { useEditorContext } from '../context';

export type CanvasRootProps = React.ComponentPropsWithRef<'div'>;

/**
 * Placeholder surface: proves the entry wiring (context shared with
 * `/editor`) and reserves the part name. Rendering, measurement and
 * interaction arrive with the canvas issues.
 */
export function CanvasRoot(props: CanvasRootProps) {
  useEditorContext('Canvas.Root');
  return <div data-editor-canvas="" {...props} />;
}
