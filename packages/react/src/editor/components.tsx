import * as React from 'react';

import type { EditorDocument } from './core/document';
import type { AnyEditorSchema } from './core/schema';
import type { EditorCallbacks, EditorStore } from './core/store';
import type { FieldControls } from './field/types';
import type { EditorScrollToOptions } from './scroll';
import type { EditorContextValue } from './types';

import { EditorContext } from './context';
import { createEditorStore } from './core/store';
import { isHTMLElement } from './dom';
import { scrollElementIntoView } from './scroll';

const EMPTY_FIELDS: FieldControls = {};

export type EditorRootProps = {
  /** The editor schema: root, components, placement. */
  schema: AnyEditorSchema;
  /** The initial document (`root.type === 'root'`). Read once at mount; use `key` to load a different document. */
  defaultValue: EditorDocument;
  /** After every local structural change incl. undo/redo. */
  onChange?: EditorCallbacks['onChange'];
  /** Called by `save()` with the full document. */
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
 * from `schema` + `defaultValue` (uncontrolled: remount with `key` to reset)
 * and exposes `{ schema, store, userId, fields, registerScrollTarget,
 * scrollTo }` to every part below it. Callback props are read fresh on every
 * call, so inline handlers are fine.
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
      initialValue: defaultValue,
      genId,
      userId,
      getCallbacks: () => callbacksRef.current,
    });
    const targets = new Map<string, HTMLElement>();
    const registerScrollTarget = (
      blockId: string,
      el: HTMLElement,
    ): (() => void) => {
      targets.set(blockId, el);
      return () => {
        if (targets.get(blockId) === el) targets.delete(blockId);
      };
    };
    const scrollTo = (
      blockId: string,
      opts?: EditorScrollToOptions,
    ): boolean => {
      if (opts?.container) {
        const found = opts.container.querySelector(
          '[data-block-id="' + CSS.escape(blockId) + '"]',
        );
        if (!isHTMLElement(found)) return false;
        scrollElementIntoView(found, opts);
        return true;
      }
      const el = targets.get(blockId);
      if (!el) return false;
      scrollElementIntoView(el, opts);
      return true;
    };
    storeRef.current = {
      schema,
      store,
      userId,
      fields,
      registerScrollTarget,
      scrollTo,
    };
  }

  return (
    <EditorContext.Provider value={storeRef.current}>
      {children}
    </EditorContext.Provider>
  );
}
