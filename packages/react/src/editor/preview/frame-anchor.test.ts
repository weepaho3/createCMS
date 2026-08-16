// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { frameClickAnchor } from './frame-anchor';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('frameClickAnchor', () => {
  it('returns null when the target is not an element', () => {
    expect(frameClickAnchor(null)).toBeNull();
    expect(frameClickAnchor(document.createTextNode('x'))).toBeNull();
  });

  it('returns blockId and key for a field inside its block', () => {
    const root = mount(
      '<section data-editor-block="h1">' +
        '<h1 data-editor-field="text">Hello</h1>' +
        '</section>',
    );
    const h1 = root.querySelector('h1');
    expect(frameClickAnchor(h1)).toEqual({
      blockId: 'h1',
      key: 'text',
    });
  });

  it('does not use the outer id when the field belongs to a nested block', () => {
    const root = mount(
      '<section data-editor-block="outer">' +
        '<h1 data-editor-field="text">Outer</h1>' +
        '<section data-editor-block="inner">' +
        '<h1 data-editor-field="text">Inner</h1>' +
        '</section>' +
        '</section>',
    );
    const inner = root.querySelector('[data-editor-block="inner"] h1');
    expect(frameClickAnchor(inner)).toEqual({
      blockId: 'inner',
      key: 'text',
    });
  });

  it('lets a non-null resolveAnchor win', () => {
    const root = mount(
      '<section data-editor-block="h1">' +
        '<h1 data-editor-field="text">Hello</h1>' +
        '</section>',
    );
    const h1 = root.querySelector('h1');
    expect(
      frameClickAnchor(h1, () => ({ blockId: 'other', key: 'x' })),
    ).toEqual({ blockId: 'other', key: 'x' });
  });

  it('falls through to data attributes when resolveAnchor returns null', () => {
    const root = mount(
      '<section data-editor-block="h1">' +
        '<h1 data-editor-field="text">Hello</h1>' +
        '</section>',
    );
    const h1 = root.querySelector('h1');
    expect(frameClickAnchor(h1, () => null)).toEqual({
      blockId: 'h1',
      key: 'text',
    });
  });
});
