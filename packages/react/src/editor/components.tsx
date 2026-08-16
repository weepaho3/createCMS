import type { BlockTreeNode } from '@createcms/schema';

import * as React from 'react';

import type { FieldControls } from './field/types';
import type { AnyEditorSchema } from './schema';
import type { EditorCallbacks, EditorStore } from './store';
import type { EditorContextValue } from './types';

import { EditorContext } from './context';
import { createEditorStore } from './store';

const EMPTY_FIELDS: FieldControls = {};

export type EditorRootProps = {
  /** The collection definition — required, a tree alone cannot name its collection. */
  schema: AnyEditorSchema;
  /** The initial tree (top node `type: 'root'`). Read once at mount; use `key` to load a different document. */
  defaultValue: BlockTreeNode;
  /** After every local structural change incl. undo/redo. */
  onChange?: EditorCallbacks['onChange'];
  /** Called by `save()` with the full tree. */
  onSave?: EditorCallbacks['onSave'];
  /** Id generator for new blocks (default: `createBlockId`). Read once at mount. */
  genId?: () => string;
  /** The user this editor edits as (default `'local'`). Read once at mount. */
  userId?: string;
  /** Control components per field kind, used by `Editor.FieldControl` (kinds without an entry use the built-in default). Read once at mount. */
  fields?: FieldControls;
  children?: React.ReactNode;
};

/**
 * Provider-only root: renders no DOM element, creates the editor store once
 * from `schema` + `defaultValue` (uncontrolled — remount with `key` to reset)
 * and exposes `{ schema, store, userId, fields }` to every part below it.
 * Callback props are read fresh on every call, so inline handlers are fine.
 */
export function EditorRoot({
  schema,
  defaultValue,
  onChange,
  onSave,
  genId,
  userId = 'local',
  fields = EMPTY_FIELDS,
  children,
}: EditorRootProps) {
  const callbacksRef = React.useRef<EditorCallbacks>({ onChange, onSave });
  React.useLayoutEffect(() => {
    callbacksRef.current = { onChange, onSave };
  });

  const storeRef = React.useRef<EditorContextValue | null>(null);
  if (storeRef.current === null) {
    const store: EditorStore = createEditorStore({
      schema,
      initialTree: defaultValue,
      genId,
      userId,
      getCallbacks: () => callbacksRef.current,
    });
    storeRef.current = { schema, store, userId, fields };
  }

  return (
    <EditorContext.Provider value={storeRef.current}>
      {children}
    </EditorContext.Provider>
  );
}
