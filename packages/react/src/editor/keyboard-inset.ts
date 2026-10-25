import * as React from 'react';

/** `navigator.virtualKeyboard` (VirtualKeyboard API, Chromium only). */
type VirtualKeyboard = EventTarget & {
  overlaysContent: boolean;
  boundingRect: DOMRectReadOnly;
};

function virtualKeyboardOf(win: Window): VirtualKeyboard | null {
  const keyboard = (win.navigator as { virtualKeyboard?: VirtualKeyboard })
    .virtualKeyboard;
  return keyboard?.overlaysContent ? keyboard : null;
}

/**
 * The height in px the on-screen keyboard covers at the bottom of the
 * layout viewport, 0 while it is closed. Reads the VirtualKeyboard API's
 * geometry where the page opted into `overlaysContent` (the same value as
 * `env(keyboard-inset-height)`), else `innerHeight - visualViewport.height
 * - visualViewport.offsetTop`. Updates at most once per frame and re-reads
 * on `focusout`, where iOS reports a stale `offsetTop` until the next
 * scroll. Move bottom-anchored chrome with
 * `transform: translateY(-<inset>px)` so it stays above the keyboard
 * without a layout pass.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = React.useState(0);
  React.useEffect(() => {
    const win = globalThis.window as Window | undefined;
    if (!win) return;
    const keyboard = virtualKeyboardOf(win);
    const viewport = win.visualViewport;
    if (!keyboard && !viewport) return;
    const read = (): number => {
      if (keyboard) return Math.max(0, keyboard.boundingRect.height);
      if (!viewport) return 0;
      return Math.max(
        0,
        Math.round(win.innerHeight - viewport.height - viewport.offsetTop),
      );
    };
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = win.requestAnimationFrame(() => {
        frame = null;
        setInset(read());
      });
    };
    setInset(read());
    const source: EventTarget | null = keyboard ?? viewport;
    const events = keyboard ? ['geometrychange'] : ['resize', 'scroll'];
    for (const type of events) source?.addEventListener(type, schedule);
    win.addEventListener('focusout', schedule);
    return () => {
      for (const type of events) source?.removeEventListener(type, schedule);
      win.removeEventListener('focusout', schedule);
      if (frame !== null) win.cancelAnimationFrame(frame);
    };
  }, []);
  return inset;
}
