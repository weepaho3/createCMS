import * as React from 'react';

import { isHTMLElement } from './dom';

const ITEMS =
  'button, a[href], input, select, textarea, [role="button"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="checkbox"], [data-roving-item]';

export type RovingFocusOptions = {
  /** Which arrows move: left/right (`horizontal`, default) or up/down. */
  orientation?: 'horizontal' | 'vertical';
  /** Arrows wrap from the last item to the first and back. Default `true`. */
  loop?: boolean;
  /** Mirrors left/right for `rtl`. */
  dir?: 'ltr' | 'rtl';
};

export type RovingFocus<T extends HTMLElement> = {
  /** Attach to the container (toolbar, menu). */
  ref: (el: T | null) => void;
  onKeyDown: (event: React.KeyboardEvent<T>) => void;
  onFocus: (event: React.FocusEvent<T>) => void;
  /** Focuses the current item (the first one until the user moved). */
  focus: () => boolean;
};

const ROOT_ATTR = 'data-roving-root';

/** The container's own items in DOM order: enabled, not inside a nested roving container. */
function itemsOf(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll(ITEMS)).filter(
    (el): el is HTMLElement =>
      isHTMLElement(el) &&
      el.closest(`[${ROOT_ATTR}]`) === root &&
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute('aria-disabled') !== 'true',
  );
}

/**
 * One tab stop for a group of controls (APG toolbar and menu pattern): the
 * current item has `tabIndex` 0, every other one -1; arrows move between
 * items, Home and End jump to the ends. Items are the container's buttons,
 * links, form controls, menu items and `data-roving-item` elements, also
 * when they mount later.
 */
export function useRovingFocus<T extends HTMLElement>(
  options: RovingFocusOptions = {},
): RovingFocus<T> {
  const { orientation = 'horizontal', loop = true, dir = 'ltr' } = options;
  const [root, setRoot] = React.useState<T | null>(null);
  const currentRef = React.useRef<HTMLElement | null>(null);

  const normalize = React.useCallback(() => {
    if (!root) return [];
    const items = itemsOf(root);
    let current = currentRef.current;
    if (!current || !items.includes(current)) current = items[0] ?? null;
    currentRef.current = current;
    for (const item of items) {
      const tabIndex = item === current ? 0 : -1;
      if (item.tabIndex !== tabIndex) item.tabIndex = tabIndex;
    }
    return items;
  }, [root]);

  React.useLayoutEffect(() => {
    if (!root) return;
    root.setAttribute(ROOT_ATTR, '');
    normalize();
    const view = root.ownerDocument.defaultView;
    if (!view?.MutationObserver) return;
    const observer = new view.MutationObserver(() => normalize());
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled'],
    });
    return () => observer.disconnect();
  }, [root, normalize]);

  const moveTo = React.useCallback(
    (item: HTMLElement | undefined) => {
      if (!item) return false;
      currentRef.current = item;
      normalize();
      item.focus();
      return true;
    },
    [normalize],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<T>) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const items = normalize();
      const target = event.target as HTMLElement;
      const at = items.indexOf(target);
      if (at === -1) return;
      const horizontal = orientation === 'horizontal';
      const forward = horizontal
        ? dir === 'rtl'
          ? 'ArrowLeft'
          : 'ArrowRight'
        : 'ArrowDown';
      const backward = horizontal
        ? dir === 'rtl'
          ? 'ArrowRight'
          : 'ArrowLeft'
        : 'ArrowUp';
      const last = items.length - 1;
      let next: number | null = null;
      if (event.key === forward) {
        next = at === last ? (loop ? 0 : last) : at + 1;
      } else if (event.key === backward) {
        next = at === 0 ? (loop ? last : 0) : at - 1;
      } else if (event.key === 'Home') {
        next = 0;
      } else if (event.key === 'End') {
        next = last;
      }
      if (next === null) return;
      event.preventDefault();
      moveTo(items[next]);
    },
    [normalize, orientation, dir, loop, moveTo],
  );

  const onFocus = React.useCallback(
    (event: React.FocusEvent<T>) => {
      if (!root) return;
      const target = event.target as HTMLElement;
      if (itemsOf(root).includes(target)) {
        currentRef.current = target;
        normalize();
      }
    },
    [root, normalize],
  );

  const focus = React.useCallback(() => {
    const items = normalize();
    return moveTo(currentRef.current ?? items[0]);
  }, [normalize, moveTo]);

  return { ref: setRoot, onKeyDown, onFocus, focus };
}
