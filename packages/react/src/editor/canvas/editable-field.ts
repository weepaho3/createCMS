import * as React from 'react';

import { EditorContext } from '../context';
import { fieldsOf } from '../core/schema';
import { isHTMLElement } from '../dom';
import { CanvasContext } from './context';
import { caretRangeAtPoint, stripPlaceholder } from './inline-text';
import {
  bindPlainText,
  normalizePlainText,
  type PlainTextOptions,
} from './plain-text';

const subscribeNoop = () => () => {};

/** What `useEditableField` hands the component for its text element. */
export type EditableField = {
  /**
   * True inside an editing canvas: the hook owns the element's text, so the
   * component renders no children for it. False elsewhere (production,
   * read-only canvases): render the value as usual.
   */
  readonly editable: boolean;
  /** An in-place session runs on this field. */
  readonly editing: boolean;
  /** Spread onto the text element, next to `edit.field.<key>`. */
  readonly props: {
    ref?: (el: HTMLElement | null) => void;
    contentEditable?: 'plaintext-only';
    suppressContentEditableWarning?: boolean;
    role?: 'textbox';
    'aria-label'?: string;
    'aria-multiline'?: 'false';
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
    onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
  };
};

const NOT_EDITABLE: EditableField = {
  editable: false,
  editing: false,
  props: {},
};

const isModKey = (event: KeyboardEvent) => event.metaKey || event.ctrlKey;

/**
 * In-place plain-text editing of a component's own element, for text the
 * glass cannot copy (gradients with `background-clip: text`, balanced
 * wrapping, columns, transforms). A click on the element starts the
 * session: it turns editable and takes focus with the caret at the click
 * point (never during a drag); React leaves its text alone while the hook
 * owns it; edits commit as `string` props with the glass's rules (line
 * breaks, `maxLength`, paste, IME). Set the field's `inline: 'in-place'` so
 * the glass skips it.
 *
 * ```tsx
 * const title = useEditableField(id, 'title');
 * return <h1 {...edit.field.title} {...title.props}>{title.editable ? null : props.title}</h1>;
 * ```
 */
export function useEditableField(blockId: string, key: string): EditableField {
  const ctx = React.useContext(EditorContext);
  const canvas = React.useContext(CanvasContext);
  const store = ctx?.store ?? null;
  const active = store !== null && canvas?.interactive === 'edit';

  const value = React.useSyncExternalStore(
    store ? store.subscribeDoc : subscribeNoop,
    () => {
      const raw = store?.getDoc().nodes[blockId]?.props[key];
      return typeof raw === 'string' ? raw : '';
    },
    () => '',
  );
  const editing = React.useSyncExternalStore(
    store ? store.subscribeSession : subscribeNoop,
    () => {
      const current = store?.getSession().editing;
      return current?.blockId === blockId && current.key === key;
    },
    () => false,
  );
  const [hovered, setHovered] = React.useState(false);
  const [el, setEl] = React.useState<HTMLElement | null>(null);
  const dragging = canvas?.dragging ?? false;

  const field = React.useMemo(() => {
    if (!store) return undefined;
    const type = store.getDoc().nodes[blockId]?.type;
    return type ? fieldsOf(store.schema, type)[key] : undefined;
  }, [store, blockId, key]);
  const optionsRef = React.useRef<PlainTextOptions>({
    multiline: false,
    maxLength: undefined,
  });
  optionsRef.current = {
    multiline: false,
    maxLength: field && 'maxLength' in field ? field.maxLength : undefined,
  };

  // The element's text follows the stored value whenever they differ
  // (load, undo, remote), with the caret at the end while focused.
  React.useLayoutEffect(() => {
    if (!active || !el) return;
    const shown = stripPlaceholder(el.textContent ?? '');
    if (shown === value) return;
    el.textContent = value === '' ? '​' : value;
    if (el.ownerDocument.activeElement === el) {
      const selection = el.ownerDocument.getSelection();
      selection?.selectAllChildren(el);
      selection?.collapseToEnd();
    }
  }, [active, el, value]);

  const commit = React.useCallback(
    (coalesce: boolean) => {
      if (!store || !el) return;
      const text = normalizePlainText(
        stripPlaceholder(el.textContent ?? ''),
        optionsRef.current.multiline,
      );
      if (text === value) return;
      store.update(blockId, { [key]: text }, { coalesce });
    },
    [store, el, blockId, key, value],
  );
  const commitRef = React.useRef(commit);
  commitRef.current = commit;

  const composingRef = React.useRef<() => boolean>(() => false);
  React.useEffect(() => {
    if (!active || !el) return;
    const plain = bindPlainText(
      el,
      () => optionsRef.current,
      () => commitRef.current(true),
    );
    composingRef.current = plain.isComposing;
    const onInput = () => {
      if (!plain.isComposing()) commitRef.current(true);
    };
    el.addEventListener('input', onInput);
    return () => {
      el.removeEventListener('input', onInput);
      plain.unbind();
      composingRef.current = () => false;
    };
  }, [active, el]);

  React.useEffect(() => {
    if (dragging && editing) el?.blur();
  }, [dragging, editing, el]);

  // Locked canvas content takes no clicks: click-to-edit starts the session
  // and the element takes focus here, with the caret at the click point.
  const caretRef = canvas?.inlineCaret ?? null;
  React.useLayoutEffect(() => {
    if (!active || !editing || dragging || !el) return;
    const doc = el.ownerDocument;
    if (doc.activeElement === el) return;
    el.focus({ preventScroll: true });
    const point = caretRef?.current ?? null;
    if (caretRef) caretRef.current = null;
    const range = point ? caretRangeAtPoint(doc, point.x, point.y) : null;
    const selection = doc.getSelection();
    if (!selection) return;
    if (range && el.contains(range.startContainer)) {
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      selection.selectAllChildren(el);
      selection.collapseToEnd();
    }
  }, [active, editing, dragging, el, caretRef]);

  const ref = React.useCallback((node: HTMLElement | null) => {
    setEl(isHTMLElement(node) ? node : null);
  }, []);

  if (!active || !store || !ctx) return NOT_EDITABLE;

  const turnedOn = (hovered || editing) && !dragging;
  return {
    editable: true,
    editing,
    props: {
      ref,
      contentEditable: turnedOn ? 'plaintext-only' : undefined,
      suppressContentEditableWarning: true,
      role: 'textbox',
      'aria-label': field?.label ?? ctx.messages.parts.inlineText,
      'aria-multiline': 'false',
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onFocus: () => {
        store.select(blockId);
        store.focus({ blockId, key });
        store.setEditing({ blockId, key });
      },
      onBlur: () => {
        commit(false);
        const current = store.getSession().editing;
        if (current?.blockId === blockId && current.key === key) {
          store.setEditing(null);
        }
      },
      onKeyDown: (event) => {
        if (event.nativeEvent.isComposing || composingRef.current()) return;
        if (isModKey(event.nativeEvent) && event.key.toLowerCase() === 'z') {
          event.preventDefault();
          commit(false);
          if (event.shiftKey) store.redo();
          else store.undo();
          return;
        }
        if (
          (event.key === 'Enter' && !event.shiftKey) ||
          event.key === 'Escape'
        ) {
          event.preventDefault();
          el?.blur();
        }
      },
    },
  };
}
