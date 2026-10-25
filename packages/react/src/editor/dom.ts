// Realm-safe DOM guards. A constructor check against HTMLElement uses the
// calling window's constructor, so it is false for nodes that live in a
// same-origin iframe. These guards check the node shape instead.

const ELEMENT_NODE = 1;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export function isNode(value: unknown): value is Node {
  return (
    value != null &&
    typeof value === 'object' &&
    typeof (value as Node).nodeType === 'number' &&
    typeof (value as Node).nodeName === 'string'
  );
}

export function isElement(value: unknown): value is Element {
  return isNode(value) && value.nodeType === ELEMENT_NODE;
}

export function isHTMLElement(value: unknown): value is HTMLElement {
  return (
    isElement(value) &&
    value.namespaceURI === HTML_NAMESPACE &&
    'style' in value
  );
}

/**
 * The computed style of `el` in its own window, or `null`: Firefox returns
 * `null` while the element's window is not rendered (a removed or hidden
 * frame), and a document without a window has none.
 */
export function computedStyleOf(el: Element): CSSStyleDeclaration | null {
  const style: CSSStyleDeclaration | null | undefined =
    el.ownerDocument.defaultView?.getComputedStyle(el);
  return style ?? null;
}

export function viewOf(node: Node | null | undefined): Window | null {
  return node?.ownerDocument?.defaultView ?? null;
}
