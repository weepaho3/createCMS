/**
 * Plain-text editing rules shared by the inline glass and in-place fields:
 * line breaks, `maxLength` and pasted text are handled in `beforeinput`
 * (except during IME composition, which cannot be cancelled), and the
 * committed text is normalised.
 */

const NBSP = / /g;
const LINE_BREAKS = /\r\n?|\n/g;

/** The text a field stores: NBSP as spaces, one line unless `multiline`, no trailing newline. */
export function normalizePlainText(text: string, multiline: boolean): string {
  let out = text.replace(NBSP, ' ').replace(/\r\n?/g, '\n');
  out = out.replace(/\n+$/, '');
  return multiline ? out : out.replace(LINE_BREAKS, ' ');
}

export type PlainTextOptions = {
  multiline: boolean;
  maxLength: number | undefined;
};

function selectedLength(el: HTMLElement, event: InputEvent): number {
  const ranges = event.getTargetRanges?.() ?? [];
  let total = 0;
  for (const range of ranges) {
    if (range.startContainer === range.endContainer) {
      total += range.endOffset - range.startOffset;
    } else {
      const live = el.ownerDocument.createRange();
      live.setStart(range.startContainer, range.startOffset);
      live.setEnd(range.endContainer, range.endOffset);
      total += live.toString().length;
    }
  }
  if (ranges.length > 0) return total;
  return el.ownerDocument.getSelection()?.toString().length ?? 0;
}

/** Inserts `text` at the selection inside `el` and reports it as input. */
function insertAtSelection(el: HTMLElement, text: string): void {
  const selection = el.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  if (text) {
    const node = el.ownerDocument.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  el.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }),
  );
}

/**
 * The `beforeinput` rules: no paragraph or line break in a single-line
 * field, `maxLength` enforced for typing and pasting (a paste is cut to fit
 * and normalised), nothing while composing.
 */
export function handleBeforeInput(
  el: HTMLElement,
  event: InputEvent,
  options: PlainTextOptions,
  composing: boolean,
): void {
  if (composing || event.isComposing) return;
  const type = event.inputType;
  if (type === 'insertCompositionText') return;
  if (type === 'insertParagraph' || type === 'insertLineBreak') {
    if (!options.multiline) event.preventDefault();
    return;
  }
  const current = (el.textContent ?? '').replace(/​/g, '').length;
  const room =
    options.maxLength === undefined
      ? Number.POSITIVE_INFINITY
      : options.maxLength - (current - selectedLength(el, event));
  if (
    type === 'insertFromPaste' ||
    type === 'insertFromDrop' ||
    type === 'insertReplacementText'
  ) {
    const raw = event.dataTransfer?.getData('text/plain') ?? event.data ?? '';
    const text = normalizePlainText(raw, options.multiline);
    const fitted = text.slice(0, Math.max(0, room));
    if (fitted === raw) return;
    event.preventDefault();
    insertAtSelection(el, fitted);
    return;
  }
  if (type === 'insertText' && event.data && event.data.length > room) {
    event.preventDefault();
  }
}

/**
 * Binds the plain-text rules to `el`. `isComposing()` is true between
 * `compositionstart` and `compositionend`; `onCompositionEnd` runs after a
 * composition committed (one history step). Returns an unbind function.
 */
export function bindPlainText(
  el: HTMLElement,
  getOptions: () => PlainTextOptions,
  onCompositionEnd: () => void,
): { isComposing: () => boolean; unbind: () => void } {
  let composing = false;
  const onBeforeInput = (event: Event) => {
    handleBeforeInput(el, event as InputEvent, getOptions(), composing);
  };
  const onStart = () => {
    composing = true;
  };
  const onEnd = () => {
    composing = false;
    onCompositionEnd();
  };
  el.addEventListener('beforeinput', onBeforeInput);
  el.addEventListener('compositionstart', onStart);
  el.addEventListener('compositionend', onEnd);
  return {
    isComposing: () => composing,
    unbind() {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('compositionstart', onStart);
      el.removeEventListener('compositionend', onEnd);
    },
  };
}
