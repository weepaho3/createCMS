import * as React from 'react';

import { useEditorContext } from './context';

export type EditorSlotProps = {
  /** The outlet name plugins contribute to (`block-toolbar`, `inspector-footer`, ...). */
  name: string;
  /** Rendered when no plugin contributes to `name`. */
  fallback?: React.ReactNode;
  /** Passed to every contributed component. */
  props?: Readonly<Record<string, unknown>>;
  /** The outlet's own content, rendered before the contributions. */
  children?: React.ReactNode;
};

/**
 * A named outlet: renders `children`, then each plugin's `slots[name]`
 * component in plugin order, so plugins add UI without forking the shell.
 * Renders `fallback` (default nothing) in place of the contributions when
 * no plugin contributes.
 */
export function EditorSlot({
  name,
  fallback = null,
  props,
  children,
}: EditorSlotProps) {
  const ctx = useEditorContext('Editor.Slot');
  const parts = ctx.store.plugins.flatMap((plugin) => {
    const Component = plugin.slots?.[name] as
      | React.ComponentType<Record<string, unknown>>
      | undefined;
    return Component ? [{ key: plugin.name, Component }] : [];
  });
  return (
    <>
      {children}
      {parts.length === 0 ? fallback : null}
      {parts.map(({ key, Component }) => (
        <Component key={key} {...props} />
      ))}
    </>
  );
}
