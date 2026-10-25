// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { blockElements, fieldElements, slotElements } from './anchors';

function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('anchor readers', () => {
  const canvas = mount(
    '<section data-editor-block="cols">' +
      '<div data-editor-slot="left" id="left">' +
      '<article data-editor-block="a"><div data-editor-slot="left" id="nested"></div></article>' +
      '</div>' +
      '<div data-editor-slot="right" id="right"></div>' +
      '<h2 data-editor-field="title" id="title"></h2>' +
      '</section>' +
      '<div data-editor-readonly="">' +
      '<section data-editor-block="cols" id="ro"></section>' +
      '</div>',
  );

  it('slotElements returns the block own slot, never a nested block one', () => {
    expect(slotElements(canvas, 'cols', 'left').map((el) => el.id)).toEqual([
      'left',
    ]);
    expect(slotElements(canvas, 'a', 'left').map((el) => el.id)).toEqual([
      'nested',
    ]);
    expect(slotElements(canvas, 'cols', 'missing')).toEqual([]);
  });

  it('a block that is its own slot element counts', () => {
    const own = mount(
      '<ul data-editor-block="list" data-editor-slot="children" id="own"></ul>',
    );
    expect(slotElements(own, 'list', 'children').map((el) => el.id)).toEqual([
      'own',
    ]);
  });

  it('skips readonly subtrees and scopes fields to their block', () => {
    expect(blockElements(canvas, 'cols')).toHaveLength(1);
    expect(fieldElements(canvas, 'cols', 'title').map((el) => el.id)).toEqual([
      'title',
    ]);
  });
});
