const MIRROR_ATTR = 'data-editor-mirrored';

/** FNV-1a over the text: a cheap identity for deduplicating style content. */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function isStyleElement(node: Node): node is Element {
  if (node.nodeType !== 1) return false;
  const el = node as Element;
  if (el.tagName === 'STYLE') return true;
  return (
    el.tagName === 'LINK' &&
    (el.getAttribute('rel') ?? '').toLowerCase() === 'stylesheet'
  );
}

/** What two style elements with the same key would add twice. */
function keyOf(el: Element): string {
  return el.tagName === 'STYLE'
    ? `style:${hashText(el.textContent ?? '')}`
    : `link:${(el as HTMLLinkElement).href}`;
}

export type StyleMirror = {
  /** Resolves when every mirrored stylesheet link loaded or failed. */
  readonly ready: Promise<void>;
  destroy(): void;
};

/**
 * Copies the host head's `<style>` and `<link rel="stylesheet">` elements
 * into the frame head and keeps additions, removals and text edits in sync
 * (CSS-in-JS that injects later included). Identical content is copied
 * once. Not covered: rules added through CSSOM (`insertRule`) and
 * `adoptedStyleSheets`, which leave no DOM trace and cannot be shared
 * across documents.
 */
export function mirrorHostStyles(
  hostDoc: Document,
  frameDoc: Document,
): StyleMirror {
  const copies = new Map<Element, Element>();
  const byKey = new Map<string, { copy: Element; owners: number }>();
  const pending: Promise<void>[] = [];
  const HostObserver = hostDoc.defaultView?.MutationObserver;

  const add = (el: Element) => {
    if (copies.has(el)) return;
    const key = keyOf(el);
    const shared = byKey.get(key);
    if (shared) {
      shared.owners += 1;
      copies.set(el, shared.copy);
      return;
    }
    const copy = frameDoc.importNode(el, true);
    copy.setAttribute(MIRROR_ATTR, '');
    if (copy.tagName === 'LINK') {
      pending.push(
        new Promise((resolve) => {
          copy.addEventListener('load', () => resolve(), { once: true });
          copy.addEventListener('error', () => resolve(), { once: true });
        }),
      );
    }
    frameDoc.head.append(copy);
    copies.set(el, copy);
    byKey.set(key, { copy, owners: 1 });
  };

  const remove = (el: Element) => {
    const copy = copies.get(el);
    if (!copy) return;
    copies.delete(el);
    for (const [key, entry] of byKey) {
      if (entry.copy !== copy) continue;
      entry.owners -= 1;
      if (entry.owners === 0) {
        copy.remove();
        byKey.delete(key);
      }
    }
  };

  const refresh = (el: Element) => {
    if (el.tagName !== 'STYLE' || !copies.has(el)) return;
    remove(el);
    add(el);
  };

  for (const el of hostDoc.head.querySelectorAll(
    'style, link[rel="stylesheet" i]',
  )) {
    add(el);
  }
  const ready = Promise.all(pending).then(() => undefined);

  const observer = HostObserver
    ? new HostObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') {
            const owner = record.target.parentElement;
            if (owner) refresh(owner);
            continue;
          }
          for (const node of record.removedNodes) {
            if (isStyleElement(node)) remove(node);
          }
          for (const node of record.addedNodes) {
            if (isStyleElement(node)) add(node);
          }
        }
      })
    : null;
  observer?.observe(hostDoc.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  return {
    ready,
    destroy() {
      observer?.disconnect();
      for (const { copy } of byKey.values()) copy.remove();
      byKey.clear();
      copies.clear();
    },
  };
}
