// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { blockElements, fieldElements } from './anchors';
import {
  overlayChromeFitsAbove,
  unionRects,
  visibleIntersection,
} from './rect';
describe('visibleIntersection', () => {
  const view = {
    scrollLeft: 0,
    scrollTop: 0,
    clientWidth: 800,
    clientHeight: 600,
  };

  it('returns the rect when it is fully in view', () => {
    expect(
      visibleIntersection({ x: 10, y: 20, width: 80, height: 40 }, view),
    ).toEqual({ x: 10, y: 20, width: 80, height: 40 });
  });

  it('clips to the scrollport', () => {
    expect(
      visibleIntersection({ x: -20, y: -10, width: 80, height: 40 }, view),
    ).toEqual({ x: 0, y: 0, width: 60, height: 30 });
  });

  it('returns null when fully scrolled away', () => {
    expect(
      visibleIntersection(
        { x: 0, y: 0, width: 80, height: 40 },
        { ...view, scrollTop: 80 },
      ),
    ).toBeNull();
  });
});

describe('overlayChromeFitsAbove', () => {
  it('is false when the block sits at the top of the scrollport', () => {
    expect(
      overlayChromeFitsAbove(
        { x: 0, y: 0, width: 100, height: 80 },
        {
          scrollLeft: 0,
          scrollTop: 0,
          clientWidth: 800,
          clientHeight: 600,
        },
        0,
      ),
    ).toBe(false);
  });

  it('is true when there is room above the block', () => {
    expect(
      overlayChromeFitsAbove(
        { x: 0, y: 80, width: 100, height: 80 },
        {
          scrollLeft: 0,
          scrollTop: 0,
          clientWidth: 800,
          clientHeight: 600,
        },
        0,
      ),
    ).toBe(true);
  });
});

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
