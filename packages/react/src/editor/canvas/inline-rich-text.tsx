import * as React from 'react';

import type { RichTextHandle } from '../core/richtext/adapter';
import type { RichTextDoc, RichTextSchema } from '../core/richtext/types';
import type { Field } from '../core/schema';

import { useDocSelector } from '../binding';
import { useEditorContext } from '../context';
import {
  EMPTY_RICH_TEXT,
  isRichTextDoc,
  richTextSchemaOf,
} from '../core/richtext/schema';
import { fieldsOf } from '../core/schema';
import { isHTMLElement } from '../dom';
import {
  DefaultRichTextToolbar,
  RichTextFieldContext,
} from '../field/rich-text-parts';
import { combosOf, handleEditorKey } from '../keyboard';
import { blockElements, fieldElements } from './anchors';
import { useCanvasContext } from './context';

/** The running in-place rich text session of a canvas. */
export type InlineRichTextState = {
  readonly blockId: string;
  readonly key: string;
  readonly handle: RichTextHandle;
  readonly schema: RichTextSchema;
  /** Changes with the selection and active formatting. */
  readonly selectionVersion: number;
};

export type InlineRichTextStore = {
  get(): InlineRichTextState | null;
  set(state: InlineRichTextState | null): void;
  subscribe(listener: () => void): () => void;
};

export function createInlineRichTextStore(): InlineRichTextStore {
  let state: InlineRichTextState | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function fieldElement(
  host: HTMLElement,
  blockId: string,
  key: string,
): HTMLElement | null {
  const field = fieldElements(host, blockId, key)[0];
  if (isHTMLElement(field)) return field;
  for (const block of blockElements(host, blockId)) {
    if (
      block.getAttribute('data-editor-field') === key &&
      isHTMLElement(block)
    ) {
      return block;
    }
  }
  return null;
}

/**
 * Runs the in-place rich text session while `editing` names a `richText`
 * field and `Editor.Root richText` is set: the field element's rendered
 * children are set aside and the editor mounts on the element itself, with
 * the caret at the click point; the block keeps rendering the value it had
 * when the session started, so React never touches the editor's DOM. Edits
 * write the field live; Escape or leaving the field ends the session and
 * puts the rendered children back.
 */
export function useInlineRichTextSession(
  editing: { blockId: string; key: string } | null,
  field: Field | undefined,
): void {
  const canvas = useCanvasContext('Canvas.InlineText');
  const { store, richText } = useEditorContext('Canvas.InlineText');
  const active =
    editing !== null && field?.type === 'richText' && richText !== null
      ? editing
      : null;
  const blockId = active?.blockId ?? null;
  const key = active?.key ?? null;
  const value = useDocSelector((s) =>
    blockId === null || key === null ? undefined : s.nodes[blockId]?.props[key],
  );
  const emitted = React.useRef<unknown>(undefined);
  const sessionStore = canvas.inlineRichText;

  React.useLayoutEffect(() => {
    const host = canvas.host;
    if (!host || !richText || blockId === null || key === null || !field) {
      return;
    }
    if (field.type !== 'richText') return;
    const el = fieldElement(host, blockId, key);
    if (!el) return;
    const doc = el.ownerDocument;
    const rendered = doc.createDocumentFragment();
    while (el.firstChild) rendered.append(el.firstChild);
    const schema = richTextSchemaOf(field);
    const start = store.getDoc().nodes[blockId]?.props[key];
    emitted.current = start;
    let version = 0;
    let handle: RichTextHandle | null = null;
    const publish = () => {
      if (!handle) return;
      sessionStore.set({
        blockId,
        key,
        handle,
        schema,
        selectionVersion: version,
      });
    };
    const caret = canvas.inlineCaret.current;
    canvas.inlineCaret.current = null;
    handle = richText.mount(el, {
      value: isRichTextDoc(start) ? start : EMPTY_RICH_TEXT,
      schema,
      caretFrom: caret ?? undefined,
      binding: store.getTextBinding(blockId, key) ?? undefined,
      attributes: {
        'aria-label': field.label ?? key,
        'data-editor-inline-richtext': '',
      },
      onChange: (next: RichTextDoc) => {
        emitted.current = next;
        store.update(blockId, { [key]: next }, { coalesce: true });
      },
      onSelectionChange: () => {
        version += 1;
        publish();
      },
      onBlur: () => {
        // Focus moved on: end the session unless it stays in the field
        // (a toolbar press keeps the editor's focus).
        queueMicrotask(() => {
          if (!el.contains(doc.activeElement)) {
            const current = store.getSession().editing;
            if (current?.blockId === blockId && current.key === key) {
              store.setEditing(null);
            }
          }
        });
      },
    });
    if (!caret) handle.focus();
    publish();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        event.stopPropagation();
        store.setEditing(null);
        return;
      }
      // The editor keeps no history: undo and redo run the store's.
      const shortcuts = store.commands.shortcuts();
      const history = combosOf(event).some((combo) => {
        const id = shortcuts[combo];
        return id === 'history.undo' || id === 'history.redo';
      });
      if (history) handleEditorKey(store, event);
    };
    el.addEventListener('keydown', onKeyDown, true);
    return () => {
      el.removeEventListener('keydown', onKeyDown, true);
      handle?.destroy();
      handle = null;
      while (el.firstChild) el.firstChild.remove();
      el.append(rendered);
      sessionStore.set(null);
    };
  }, [
    canvas.host,
    canvas.inlineCaret,
    richText,
    blockId,
    key,
    field,
    store,
    sessionStore,
  ]);

  // A drag never runs through an open editor.
  React.useEffect(() => {
    if (canvas.dragging && blockId !== null) store.setEditing(null);
  }, [canvas.dragging, blockId, store]);

  // Hovering a block with a rich text field starts loading a lazy editor.
  React.useEffect(() => {
    const preload = (richText as { preload?: () => Promise<unknown> } | null)
      ?.preload;
    if (!preload) return;
    const unsubscribe = store.subscribeEphemeral(() => {
      const hovered = store.getEphemeral().hoverId;
      const type = hovered ? store.getDoc().nodes[hovered]?.type : undefined;
      if (!type) return;
      const fields = Object.values(fieldsOf(store.schema, type));
      if (!fields.some((spec) => spec.type === 'richText')) return;
      void preload().catch(() => {});
      unsubscribe();
    });
    return unsubscribe;
  }, [store, richText]);

  // A value changed elsewhere (undo, a remote edit) replaces the content.
  React.useEffect(() => {
    const state = sessionStore.get();
    if (!state || state.blockId !== blockId || state.key !== key) return;
    if (value === emitted.current) return;
    emitted.current = value;
    state.handle.setValue(isRichTextDoc(value) ? value : EMPTY_RICH_TEXT);
  }, [sessionStore, blockId, key, value]);
}

export type CanvasInlineRichTextToolbarProps = {
  /** `Editor.RichTextToolbar` content; default: every format the field allows. */
  children?: React.ReactNode;
};

/**
 * The formatting toolbar of the running in-place rich text session, for
 * `Canvas.BlockToolbar`: `Editor.RichTextToolbar` and
 * `Editor.RichTextToolbarButton` work inside it. Renders nothing while no
 * rich text field is being edited. Buttons keep the editor's focus, also
 * across a frame.
 */
export function CanvasInlineRichTextToolbar({
  children,
}: CanvasInlineRichTextToolbarProps) {
  const canvas = useCanvasContext('Canvas.InlineRichTextToolbar');
  const state = React.useSyncExternalStore(
    canvas.inlineRichText.subscribe,
    canvas.inlineRichText.get,
    () => null,
  );
  const context = React.useMemo(
    () =>
      state
        ? {
            handle: state.handle,
            schema: state.schema,
            selectionVersion: state.selectionVersion,
            editable: true,
          }
        : null,
    [state],
  );
  if (!context) return null;
  return (
    <RichTextFieldContext.Provider value={context}>
      {children ?? <DefaultRichTextToolbar />}
    </RichTextFieldContext.Provider>
  );
}
