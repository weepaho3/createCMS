// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardInset } from './keyboard-inset';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'visualViewport');
  Reflect.deleteProperty(navigator, 'virtualKeyboard');
});

function Probe() {
  return <output data-testid="inset">{useKeyboardInset()}</output>;
}

function fakeViewport(height: number, offsetTop = 0) {
  const target = new EventTarget();
  return Object.assign(target, { height, offsetTop });
}

const nextFrame = () =>
  act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

describe('useKeyboardInset', () => {
  it('derives the inset from the visual viewport and follows resizes', async () => {
    const viewport = fakeViewport(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      get: () => viewport,
    });
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('inset').textContent).toBe('0');

    Object.assign(viewport, { height: 500, offsetTop: 20 });
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(getByTestId('inset').textContent).toBe('280');

    Object.assign(viewport, { height: 800, offsetTop: 0 });
    window.dispatchEvent(new FocusEvent('focusout'));
    await nextFrame();
    expect(getByTestId('inset').textContent).toBe('0');
  });

  it('prefers the VirtualKeyboard geometry when it overlays content', async () => {
    const keyboard = Object.assign(new EventTarget(), {
      overlaysContent: true,
      boundingRect: { height: 0 } as DOMRectReadOnly,
    });
    Object.defineProperty(navigator, 'virtualKeyboard', {
      configurable: true,
      value: keyboard,
    });
    const { getByTestId } = render(<Probe />);
    keyboard.boundingRect = { height: 320 } as DOMRectReadOnly;
    keyboard.dispatchEvent(new Event('geometrychange'));
    await nextFrame();
    expect(getByTestId('inset').textContent).toBe('320');
  });
});
