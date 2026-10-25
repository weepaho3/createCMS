/** Blocks with more elements than this preview as their label instead. */
export const DRAG_PREVIEW_MAX_NODES = 400;

/** Elements left out of a preview: they would load, play or run. */
const DROPPED = 'iframe, video, audio, object, embed, script, noscript, canvas';

/** Properties a preview never keeps: motion and interaction. */
const RESET: Readonly<Record<string, string>> = {
  animation: 'none',
  transition: 'none',
  'pointer-events': 'none',
  cursor: 'default',
  'user-select': 'none',
};

function copyStyle(from: Element, to: HTMLElement | SVGElement): void {
  const view = from.ownerDocument.defaultView;
  if (!view) return;
  const computed = view.getComputedStyle(from);
  const style = to.style;
  for (let i = 0; i < computed.length; i++) {
    const name = computed.item(i);
    style.setProperty(name, computed.getPropertyValue(name));
  }
  for (const [name, value] of Object.entries(RESET)) {
    style.setProperty(name, value);
  }
}

function stripAttributes(el: Element): void {
  // on purpose: a copy, the loop removes from the live attribute list.
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    if (
      name === 'id' ||
      name === 'contenteditable' ||
      name === 'tabindex' ||
      name === 'autofocus' ||
      name === 'class' ||
      name.startsWith('data-') ||
      name.startsWith('aria-') ||
      name.startsWith('on')
    ) {
      el.removeAttribute(name);
    }
  }
}

export type BlockPreviewClone = {
  /** The copy, sized as the block; scale it to fit the preview. */
  readonly node: HTMLElement;
  readonly width: number;
  readonly height: number;
};

/**
 * A static copy of a rendered block for the drag preview: every element
 * keeps its resolved style inline, so the copy looks the same in any
 * document (the frame or the host page around it) whatever stylesheets
 * and media queries apply there. Editor anchors, ids, classes, editable
 * state and event attributes are removed, embedded media and frames are
 * left out, and nothing in it is focusable or reacts to the pointer.
 * `null` for a block with more than `maxNodes` elements or without a box.
 */
export function cloneBlockForPreview(
  el: Element,
  maxNodes = DRAG_PREVIEW_MAX_NODES,
): BlockPreviewClone | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  if (el.getElementsByTagName('*').length + 1 > maxNodes) return null;
  const copy = el.cloneNode(true) as Element;
  // Walk source and copy together: they share their structure until the
  // copy drops elements, which happens after their styles are copied.
  const sources: Element[] = [el, ...el.getElementsByTagName('*')];
  const copies: Element[] = [copy, ...copy.getElementsByTagName('*')];
  const dropped: Element[] = [];
  sources.forEach((source, index) => {
    const target = copies[index];
    if (!target) return;
    if (target.matches(DROPPED)) {
      dropped.push(target);
      return;
    }
    if ('style' in target) {
      copyStyle(source, target as HTMLElement | SVGElement);
    }
    stripAttributes(target);
    if (target.tagName === 'INPUT') {
      target.setAttribute('value', (source as HTMLInputElement).value);
    }
  });
  for (const target of dropped) target.remove();
  const node = copy as HTMLElement;
  node.setAttribute('inert', '');
  node.setAttribute('aria-hidden', 'true');
  // The block's own placement stays on the page: the copy sits at the
  // preview's origin.
  for (const name of [
    'position',
    'inset',
    'top',
    'left',
    'right',
    'bottom',
    'transform',
    'translate',
    'rotate',
    'scale',
  ]) {
    node.style.removeProperty(name);
  }
  node.style.setProperty('margin', '0');
  node.style.setProperty('opacity', '1');
  node.style.setProperty('width', `${rect.width}px`);
  node.style.setProperty('height', `${rect.height}px`);
  node.style.setProperty('box-sizing', 'border-box');
  return { node, width: rect.width, height: rect.height };
}
