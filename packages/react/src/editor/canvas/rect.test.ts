// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { blockElements, fieldElements } from './anchors';
import { unionRects } from './rect';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('unionRects', () => {
  it('returns null for an empty list', () => {
    expect(unionRects([])).toBeNull();
  });

  it('unions two rects to the bounding box', () => {
    expect(
      unionRects([
        { x: 10, y: 20, width: 80, height: 40 },
        { x: 90, y: 20, width: 80, height: 40 },
      ]),
    ).toEqual({ x: 10, y: 20, width: 160, height: 40 });
  });
});

describe('blockElements', () => {
  it('does not return a node inside data-editor-readonly', () => {
    const canvas = mount(
      '<div data-editor-block="live">live</div>' +
        '<div data-editor-readonly="">' +
        '<div data-editor-block="live">readonly</div>' +
        '</div>',
    );
    const found = blockElements(canvas, 'live');
    expect(found).toHaveLength(1);
    expect(found[0]!.textContent).toBe('live');
  });
});

describe('fieldElements', () => {
  it('keeps a nested same-key field on its own block', () => {
    const canvas = mount(
      '<section data-editor-block="outer">' +
        '<h1 data-editor-field="text">Outer</h1>' +
        '<section data-editor-block="inner">' +
        '<h1 data-editor-field="text">Inner</h1>' +
        '</section>' +
        '</section>',
    );
    const outer = fieldElements(canvas, 'outer', 'text');
    const inner = fieldElements(canvas, 'inner', 'text');
    expect(outer).toHaveLength(1);
    expect(outer[0]!.textContent).toBe('Outer');
    expect(inner).toHaveLength(1);
    expect(inner[0]!.textContent).toBe('Inner');
  });
});
