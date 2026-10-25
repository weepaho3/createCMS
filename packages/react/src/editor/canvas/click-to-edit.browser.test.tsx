import { act, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Canvas } from './index';
import { dispatchPointer, rectOf, renderCanvas } from './test/harness';

afterEach(cleanup);

function headingField(host: HTMLElement): HTMLElement {
  const field = host.querySelector<HTMLElement>(
    '[data-editor-block="h1"] [data-editor-field="text"]',
  );
  if (!field) throw new Error('missing heading field');
  return field;
}

/** A tap or click: `pointerdown`, `pointerup`, then `click`. */
function press(field: HTMLElement, pointerType: 'touch' | 'mouse'): void {
  const rect = rectOf(field);
  const point = { x: rect.x + 5, y: rect.y + 5 };
  act(() => {
    dispatchPointer(field, 'pointerdown', point, {
      pointerType,
      isPrimary: true,
    });
    dispatchPointer(field, 'pointerup', point, {
      pointerType,
      isPrimary: true,
    });
    field.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      }),
    );
  });
}

describe('clickToEdit with touch input', () => {
  it('a touch pointer defaults to select-first', () => {
    const { host, store } = renderCanvas(<Canvas.InlineText />);
    const field = headingField(host);
    press(field, 'touch');
    expect(store.getSession().selection).toEqual(['h1']);
    expect(store.getSession().editing).toBeNull();
    press(field, 'touch');
    expect(store.getSession().editing).toEqual({ blockId: 'h1', key: 'text' });
  });

  it('a mouse pointer defaults to select-and-edit', () => {
    const { host, store } = renderCanvas(<Canvas.InlineText />);
    press(headingField(host), 'mouse');
    expect(store.getSession().selection).toEqual(['h1']);
    expect(store.getSession().editing).toEqual({ blockId: 'h1', key: 'text' });
  });

  it('an explicit select-and-edit wins over the touch default', () => {
    const { host, store } = renderCanvas(<Canvas.InlineText />, {
      clickToEdit: 'select-and-edit',
    });
    press(headingField(host), 'touch');
    expect(store.getSession().editing).toEqual({ blockId: 'h1', key: 'text' });
  });
});
