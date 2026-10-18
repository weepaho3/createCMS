import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { EditorStore } from '../core/store';
import type { CanvasRect } from './rect';

import { useRender } from '../../use-render';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { warnOnce } from '../core/codes';
import { fieldsOf } from '../core/schema';
import { isHTMLElement } from '../dom';
import { frameClickAnchor } from '../preview/frame-anchor';
import { fieldElements, blockElements, isInsideReadonly } from './anchors';
import { useCanvasContext } from './context';
import { useInlineRichTextSession } from './inline-rich-text';
import {
  applyTextEdit,
  caretOffsetWithin,
  caretRangeAtPoint,
  fieldOf,
  isInlineEditableField,
  isInPlaceField,
  placeCaret,
  RICH_TEXT_INLINE_WARNING,
  stripPlaceholder,
} from './inline-text';
import { isSelectionClick } from './interact';
import {
  bindPlainText,
  normalizePlainText,
  type PlainTextOptions,
} from './plain-text';
import { canvasRectOf } from './rect';
import { useFieldRect } from './rects';

function warnRichTextInlineOnce(): void {
  if (process.env.NODE_ENV !== 'production') {
    warnOnce('E001', RICH_TEXT_INLINE_WARNING);
  }
}

/** While a drag runs the glass shows no caret and takes no selection. */
const DRAGGING_GLASS: React.CSSProperties = {
  caretColor: 'transparent',
  userSelect: 'none',
};

export type InlineSuggestItem = {
  insertText: string;
  [key: string]: unknown;
};

export type InlineSuggestRenderContext = {
  items: InlineSuggestItem[];
  highlighted: number;
  query: string;
  rect: DOMRect;
  accept: (index: number) => void;
};

export type InlineSuggest = {
  pattern: RegExp;
  getItems: (query: string) => InlineSuggestItem[];
  render: (ctx: InlineSuggestRenderContext) => React.ReactNode;
};

type InlineTextState = {
  editorInlineText: boolean;
  editing: boolean;
  blockType: string;
  field: string;
};

export type CanvasInlineTextProps = React.ComponentPropsWithRef<'div'> & {
  suggest?: InlineSuggest;
  discardOnEscape?: boolean;
  render?: UseRenderComponentProps<'div', InlineTextState>['render'];
};

function insideHost(host: Element, node: Element | null): boolean {
  return node !== null && host.contains(node);
}

function isElement(target: EventTarget | null): target is Element {
  return (
    typeof target === 'object' &&
    target !== null &&
    (target as Node).nodeType === 1
  );
}

function fieldOrigin(
  host: HTMLElement,
  blockId: string,
  key: string,
): Element | null {
  const fields = fieldElements(host, blockId, key);
  if (fields[0]) return fields[0];
  for (const block of blockElements(host, blockId)) {
    if (block.getAttribute('data-editor-field') === key) return block;
  }
  return null;
}

function measureOriginField(
  host: HTMLElement,
  blockId: string,
  key: string,
): CanvasRect | null {
  const origin = fieldOrigin(host, blockId, key);
  if (!origin) return null;
  return canvasRectOf(origin, host);
}

/** The stored string of a text field; a missing value reads as `''`. */
function storedText(store: EditorStore, blockId: string, key: string): string {
  const value = store.getDoc().nodes[blockId]?.props[key];
  return typeof value === 'string' ? value : '';
}

function isModKey(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

function placeCaretFromPointer(
  glass: HTMLElement,
  host: HTMLElement,
  blockId: string,
  key: string,
  clientX: number,
  clientY: number,
): void {
  const doc = host.ownerDocument;
  const range = caretRangeAtPoint(doc, clientX, clientY);
  if (range && glass.contains(range.startContainer)) {
    const sel = doc.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return;
  }
  const origin = fieldOrigin(host, blockId, key);
  if (!isHTMLElement(origin)) {
    placeCaret(glass, glass.textContent?.length ?? 0);
    return;
  }
  const rect = origin.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : 1;
  const frac = Math.max(0, Math.min(1, (clientX - rect.x) / width));
  const len = glass.textContent?.length ?? 0;
  placeCaret(glass, Math.round(frac * len));
}

type SuggestState = {
  items: InlineSuggestItem[];
  highlighted: number;
  query: string;
  start: number;
  end: number;
};

/**
 * Overlays a contentEditable glass on string fields. During a session the
 * origin element is hidden, and an empty string property carries a zero-width
 * placeholder in the canvas render (never stored). A click on a richText field
 * selects the block and focuses its form field instead of opening the glass.
 */
export function CanvasInlineText({
  suggest,
  discardOnEscape = false,
  render,
  style,
  ...rest
}: CanvasInlineTextProps) {
  const canvas = useCanvasContext('Canvas.InlineText');
  const ctx = useEditorContext('Canvas.InlineText');
  const current = useSessionSelector((s) => s.editing);
  // Only the node being edited: other blocks never re-render the glass.
  const editedNode = useDocSelector((s) =>
    current === null ? null : (s.nodes[current.blockId] ?? null),
  );
  const editedField =
    current === null || editedNode === null
      ? undefined
      : fieldsOf(ctx.schema, editedNode.type)[current.key];
  const editing = React.useMemo(() => {
    if (current === null || editedField === undefined) return null;
    return isInlineEditableField(editedField) && !isInPlaceField(editedField)
      ? current
      : null;
  }, [editedField, current]);
  useInlineRichTextSession(current, editedField);
  const plainOptionsRef = React.useRef<PlainTextOptions>({
    multiline: false,
    maxLength: undefined,
  });
  plainOptionsRef.current = {
    multiline: false,
    maxLength:
      editedField && 'maxLength' in editedField
        ? editedField.maxLength
        : undefined,
  };
  const composingRef = React.useRef<() => boolean>(() => false);
  const glassRef = React.useRef<HTMLDivElement | null>(null);
  const seededFor = React.useRef<string | null>(null);
  const sessionStart = React.useRef<string>('');
  const skipBlurCommit = React.useRef(false);
  const [suggestState, setSuggestState] = React.useState<SuggestState | null>(
    null,
  );
  const suggestPattern = React.useMemo(
    () =>
      suggest
        ? new RegExp(
            suggest.pattern.source,
            suggest.pattern.flags.replace(/[gy]/g, ''),
          )
        : null,
    [suggest],
  );

  const syncedFieldRect = useFieldRect(
    editing?.blockId ?? '',
    editing?.key ?? '',
  );
  const [fallbackRect, setFallbackRect] = React.useState<CanvasRect | null>(
    null,
  );

  React.useLayoutEffect(() => {
    if (!canvas.host || editing === null || syncedFieldRect !== null) {
      setFallbackRect(null);
      return;
    }
    setFallbackRect(
      measureOriginField(canvas.host, editing.blockId, editing.key),
    );
  }, [canvas.host, editing, syncedFieldRect, editedNode]);

  const fieldRect = syncedFieldRect ?? fallbackRect;
  const glassShown = editing !== null && fieldRect !== null;

  const storeRaw = editing === null ? '' : editedNode?.props[editing.key];
  const storeValue = typeof storeRaw === 'string' ? storeRaw : '';

  const refreshSuggest = React.useCallback(() => {
    const el = glassRef.current;
    if (!el || !suggest || !suggestPattern || editing === null) {
      setSuggestState(null);
      return;
    }
    const caret = caretOffsetWithin(el);
    const text = el.textContent ?? '';
    const before = text.slice(0, caret);
    const match = suggestPattern.exec(before);
    if (!match) {
      setSuggestState(null);
      return;
    }
    const query = match[1] ?? '';
    const items = suggest.getItems(query);
    if (items.length === 0) {
      setSuggestState(null);
      return;
    }
    const start = before.length - match[0].length;
    setSuggestState({
      items,
      highlighted: 0,
      query,
      start,
      end: caret,
    });
  }, [suggest, suggestPattern, editing]);

  const acceptSuggest = React.useCallback(
    (index: number) => {
      const el = glassRef.current;
      const state = suggestState;
      if (!el || !state || editing === null) return;
      const item = state.items[index];
      if (!item) return;
      const text = el.textContent ?? '';
      const next = applyTextEdit(text, state.start, state.end, item.insertText);
      el.textContent = next.text;
      placeCaret(el, next.caret);
      ctx.store.update(
        editing.blockId,
        { [editing.key]: stripPlaceholder(next.text) },
        { coalesce: false },
      );
      setSuggestState(null);
    },
    [suggestState, editing, ctx.store],
  );

  const clickEdits = canvas.clickEdits;
  React.useLayoutEffect(() => {
    const host = canvas.host;
    if (!host) return;
    const onClick = (event: Event) => {
      if (canvas.interactive !== 'edit' || canvas.dragging) return;
      const target = event.target;
      if (!isElement(target)) return;
      if (isInsideReadonly(target, host)) return;

      const pointer = event as MouseEvent | PointerEvent;
      // Modifier clicks select (range, toggle, parent) and never edit.
      if (isSelectionClick(pointer)) return;

      const overlay = target.closest('[data-editor-overlay]');
      if (overlay && insideHost(host, overlay)) {
        const glass = target.closest('[data-editor-inline-text]');
        if (!glass) return;
      }

      const inlineGlass = target.closest('[data-editor-inline-text]');
      if (isHTMLElement(inlineGlass) && insideHost(host, inlineGlass)) {
        const active = ctx.store.getSession().editing;
        if (active) {
          placeCaretFromPointer(
            inlineGlass,
            host,
            active.blockId,
            active.key,
            pointer.clientX,
            pointer.clientY,
          );
          return;
        }
      }

      const anchor = frameClickAnchor(event.target);
      if (!anchor?.key) return;

      const field = fieldOf(
        ctx.schema,
        ctx.store.getDoc().nodes,
        anchor.blockId,
        anchor.key,
      );
      if (!field) return;
      // A richText field edits in place through `Editor.Root richText`.
      const richEdit =
        field.type === 'richText' && ctx.richText !== null && !field.readOnly;
      if (!isInlineEditableField(field) && !richEdit) {
        // A richText field without an editor, or a readOnly field: select
        // the block and focus its form control instead of editing inline.
        if (field.type === 'richText') warnRichTextInlineOnce();
        if (field.type === 'richText' || field.readOnly === true) {
          ctx.store.select(anchor.blockId);
          ctx.store.focus({ blockId: anchor.blockId, key: anchor.key });
        }
        return;
      }

      const current = ctx.store.getSession().editing;
      if (current?.blockId === anchor.blockId && current?.key === anchor.key) {
        const glass = host.querySelector('[data-editor-inline-text]');
        if (isHTMLElement(glass)) {
          placeCaretFromPointer(
            glass,
            host,
            anchor.blockId,
            anchor.key,
            pointer.clientX,
            pointer.clientY,
          );
        }
        return;
      }

      if (!clickEdits(anchor.blockId)) {
        ctx.store.select(anchor.blockId);
        ctx.store.focus({ blockId: anchor.blockId, key: anchor.key });
        return;
      }

      canvas.inlineCaret.current = {
        x: pointer.clientX,
        y: pointer.clientY,
      };

      ctx.store.select(anchor.blockId);
      ctx.store.focus({ blockId: anchor.blockId, key: anchor.key });
      ctx.store.setEditing({ blockId: anchor.blockId, key: anchor.key });
    };
    host.addEventListener('click', onClick, true);
    return () => {
      host.removeEventListener('click', onClick, true);
    };
  }, [
    canvas.host,
    canvas.interactive,
    canvas.dragging,
    canvas.inlineCaret,
    clickEdits,
    ctx.richText,
    ctx.schema,
    ctx.store,
  ]);

  React.useLayoutEffect(() => {
    if (editing === null) {
      seededFor.current = null;
      setSuggestState(null);
      return;
    }
    const host = canvas.host;
    if (!host) return;
    const origin = fieldOrigin(host, editing.blockId, editing.key);
    if (!isHTMLElement(origin)) return;
    const prev = origin.style.visibility;
    origin.style.visibility = 'hidden';
    return () => {
      origin.style.visibility = prev;
    };
  }, [canvas.host, editing]);

  React.useLayoutEffect(() => {
    const el = glassRef.current;
    if (!el || editing === null) return;
    const key = `${editing.blockId}:${editing.key}`;
    const doc = el.ownerDocument;
    const at = canvas.inlineCaret.current;

    if (seededFor.current !== key) {
      seededFor.current = key;
      sessionStart.current = storeValue;
      el.textContent = storeValue;
      el.focus();
      if (at) {
        const range = caretRangeAtPoint(doc, at.x, at.y);
        if (range && el.contains(range.startContainer)) {
          const sel = doc.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
        } else if (canvas.host) {
          placeCaretFromPointer(
            el,
            canvas.host,
            editing.blockId,
            editing.key,
            at.x,
            at.y,
          );
        } else {
          placeCaret(el, storeValue.length);
        }
        canvas.inlineCaret.current = null;
      } else {
        placeCaret(el, storeValue.length);
      }
      return;
    }

    const glassText = stripPlaceholder(el.textContent ?? '');
    if (glassText !== storeValue) {
      el.textContent = storeValue;
      placeCaret(el, storeValue.length);
    }
  }, [canvas.host, canvas.inlineCaret, editing, storeValue, editedNode]);

  React.useLayoutEffect(() => {
    const host = canvas.host;
    const el = glassRef.current;
    if (!host || !el || editing === null || fieldRect === null) return;

    const origin = fieldOrigin(host, editing.blockId, editing.key);
    if (!isHTMLElement(origin)) return;
    const computed = host.ownerDocument.defaultView?.getComputedStyle(origin);
    if (!computed) return;

    el.style.position = 'absolute';
    el.style.left = `${fieldRect.x}px`;
    el.style.top = `${fieldRect.y}px`;
    el.style.width = `${fieldRect.width}px`;
    el.style.height = `${fieldRect.height}px`;
    el.style.overflow = 'hidden';
    el.style.margin = '0';
    el.style.background = 'transparent';
    el.style.pointerEvents = 'auto';
    el.style.boxSizing = 'border-box';
    el.style.font = computed.font;
    el.style.lineHeight = computed.lineHeight;
    el.style.letterSpacing = computed.letterSpacing;
    el.style.textAlign = computed.textAlign;
    el.style.color = computed.color;
    el.style.paddingTop = computed.paddingTop;
    el.style.paddingRight = computed.paddingRight;
    el.style.paddingBottom = computed.paddingBottom;
    el.style.paddingLeft = computed.paddingLeft;
    el.style.whiteSpace = computed.whiteSpace;
    el.style.overflowWrap = computed.overflowWrap;
  }, [canvas.host, editing, fieldRect, storeValue]);

  React.useLayoutEffect(() => {
    const host = canvas.host;
    if (!host || !suggestState) return;
    const close = () => setSuggestState(null);
    host.addEventListener('scroll', close, true);
    host.ownerDocument.defaultView?.addEventListener('resize', close);
    return () => {
      host.removeEventListener('scroll', close, true);
      host.ownerDocument.defaultView?.removeEventListener('resize', close);
    };
  }, [canvas.host, suggestState]);

  const commit = React.useCallback(
    (coalesce: boolean) => {
      const el = glassRef.current;
      if (!el || editing === null) return;
      const text = normalizePlainText(
        stripPlaceholder(el.textContent ?? ''),
        plainOptionsRef.current.multiline,
      );
      if (text === storedText(ctx.store, editing.blockId, editing.key)) return;
      ctx.store.update(editing.blockId, { [editing.key]: text }, { coalesce });
    },
    [editing, ctx.store],
  );

  const endEditing = React.useCallback(() => {
    const el = glassRef.current;
    el?.blur();
  }, []);

  React.useLayoutEffect(() => {
    const el = glassRef.current;
    if (!el || editing === null) return;
    const plain = bindPlainText(
      el,
      () => plainOptionsRef.current,
      () => commit(true),
    );
    composingRef.current = plain.isComposing;
    const onNativeInput = () => {
      // A composition commits once, on `compositionend`.
      if (plain.isComposing()) return;
      commit(true);
      refreshSuggest();
    };
    el.addEventListener('input', onNativeInput);
    return () => {
      el.removeEventListener('input', onNativeInput);
      plain.unbind();
      composingRef.current = () => false;
    };
    // The glass mounts once its field is measured: bind to that element.
  }, [commit, editing, refreshSuggest, glassShown]);

  // A drag must never type into the glass: end the session when one starts.
  React.useEffect(() => {
    if (canvas.dragging && editing !== null) glassRef.current?.blur();
  }, [canvas.dragging, editing]);

  const onBlur = React.useCallback(() => {
    if (editing === null) return;
    if (!skipBlurCommit.current) {
      commit(false);
    }
    skipBlurCommit.current = false;
    const current = ctx.store.getSession().editing;
    if (current?.blockId === editing.blockId && current?.key === editing.key) {
      ctx.store.setEditing(null);
    }
  }, [commit, editing, ctx.store]);

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Enter and Escape confirm or cancel an IME candidate, not the session.
      if (event.nativeEvent.isComposing || composingRef.current()) return;
      if (isModKey(event.nativeEvent)) {
        if (event.key === 'z' && !event.shiftKey) {
          event.preventDefault();
          ctx.store.undo();
          return;
        }
        if (
          (event.key === 'z' && event.shiftKey) ||
          (event.key === 'y' && !event.shiftKey)
        ) {
          event.preventDefault();
          ctx.store.redo();
          return;
        }
      }

      if (suggestState) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setSuggestState((prev) =>
            prev
              ? {
                  ...prev,
                  highlighted: (prev.highlighted + 1) % prev.items.length,
                }
              : prev,
          );
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setSuggestState((prev) =>
            prev
              ? {
                  ...prev,
                  highlighted:
                    (prev.highlighted - 1 + prev.items.length) %
                    prev.items.length,
                }
              : prev,
          );
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          acceptSuggest(suggestState.highlighted);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setSuggestState(null);
          return;
        }
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        endEditing();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (discardOnEscape && editing !== null) {
          skipBlurCommit.current = true;
          if (
            sessionStart.current !==
            storedText(ctx.store, editing.blockId, editing.key)
          ) {
            ctx.store.update(
              editing.blockId,
              { [editing.key]: sessionStart.current },
              { coalesce: false },
            );
          }
        }
        endEditing();
      }
    },
    [
      acceptSuggest,
      ctx.store,
      discardOnEscape,
      editing,
      endEditing,
      suggestState,
    ],
  );

  const node = editing ? editedNode : null;

  const glass = useRender<'div', InlineTextState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      ref: glassRef,
      role: 'textbox',
      'aria-label':
        rest['aria-label'] ??
        editedField?.label ??
        ctx.messages.parts.inlineText,
      'aria-multiline': 'false',
      'aria-placeholder':
        editedField && 'placeholder' in editedField
          ? editedField.placeholder
          : undefined,
      contentEditable: 'plaintext-only',
      suppressContentEditableWarning: true,
      onBlur,
      onKeyDown,
      onMouseUp: refreshSuggest,
      onKeyUp: (event) => {
        if (
          suggestState &&
          (event.key === 'ArrowDown' ||
            event.key === 'ArrowUp' ||
            event.key === 'Enter' ||
            event.key === 'Escape')
        ) {
          return;
        }
        refreshSuggest();
      },
      style: canvas.dragging
        ? { outline: 'none', ...DRAGGING_GLASS, ...style }
        : { outline: 'none', ...style },
    },
    state: {
      editorInlineText: true,
      editing: true,
      blockType: node?.type ?? '',
      field: editing?.key ?? '',
    },
  });

  if (editing === null || fieldRect === null) return null;

  const suggestNode =
    suggestState && suggest && glassRef.current
      ? suggest.render({
          items: suggestState.items,
          highlighted: suggestState.highlighted,
          query: suggestState.query,
          rect: glassRef.current.getBoundingClientRect(),
          accept: acceptSuggest,
        })
      : null;

  return (
    <>
      {glass}
      {suggestNode}
    </>
  );
}
