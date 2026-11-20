import {
  checkDirection,
  checkPattern,
  checkServer,
  mount,
} from '@ui-sdk/core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { blockOutline } from '../../../../../registry/ui-sdk/block-outline';

const rows = [
  { key: 'heading', depth: 0 },
  { key: 'section', depth: 0 },
  { key: 'section:children', depth: 1 },
  { key: 'paragraph', depth: 2 },
  { key: 'image', depth: 0 },
];

const markup = `<root aria-label="Outline">
  <row value="heading">Heading</row>
  <row value="section">Section</row>
  <row value="section:children">Content</row>
  <row value="paragraph">Paragraph</row>
  <row value="image">Image</row>
  <instructions>Space picks a block up.</instructions>
</root>`;

let view: ReturnType<typeof mount<typeof blockOutline>> | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

const open = (
  options: Parameters<typeof mount<typeof blockOutline>>[1] = {},
) => {
  view = mount(
    blockOutline,
    {
      defaultRows: rows,
      defaultExpanded: ['section'],
      fixed: ['section:children'],
      ...options,
    },
    markup,
  );
  return view;
};

describe('block outline primitive', () => {
  it('is an APG tree with one tab stop', async () => {
    const v = open();
    await checkPattern(v.root, 'tree');
    const stops = [...v.root.querySelectorAll('[tabindex="0"]')];
    expect(stops).toHaveLength(1);
    expect(v.part('row', 'section')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(v.part('row', 'heading')!.hasAttribute('aria-expanded')).toBe(false);
    expect(v.part('row', 'paragraph')!.getAttribute('aria-level')).toBe('3');
  });

  it('selection follows focus, and Shift extends it', async () => {
    const v = open();
    v.part('row', 'heading')!.focus();
    await v.keys('ArrowDown');
    expect(v.state.selected).toEqual(['section']);
    expect(v.changes.at(-1)).toMatchObject({
      key: 'selected',
      reason: 'list-navigation',
    });
    await v.keys('Shift+ArrowDown');
    expect(v.state.selected).toEqual(['section', 'section:children']);
  });

  it('Right goes into a branch, Left back to its parent and closes it', async () => {
    const v = open();
    v.part('row', 'section')!.focus();
    await v.keys('ArrowRight');
    expect(document.activeElement).toBe(v.part('row', 'section:children'));
    await v.keys('ArrowLeft');
    expect(document.activeElement).toBe(v.part('row', 'section'));
    await v.keys('ArrowLeft');
    expect(v.state.expanded).toEqual([]);
    expect(v.part('row', 'section')!.getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('a slot row stays open and never moves', async () => {
    const v = open();
    v.part('row', 'section:children')!.focus();
    await v.keys('ArrowLeft');
    expect(v.state.expanded).toEqual(['section']);
    expect(document.activeElement).toBe(v.part('row', 'section'));
    v.part('row', 'section:children')!.focus();
    await v.keys('Space');
    expect(v.state.moving).toBeNull();
  });

  it('Space picks a block up, arrows move it, Space drops it', async () => {
    const v = open();
    v.part('row', 'heading')!.focus();
    await v.keys('Space', 'ArrowDown', 'Space');
    expect(v.state.rows.map((row) => row.key)).toEqual([
      'section',
      'heading',
      'section:children',
      'paragraph',
      'image',
    ]);
    expect(v.announced.join(' ')).toMatch(/Heading/);
  });

  it('refuses a drop the placement rules forbid and says so', async () => {
    const v = open({ canPlace: (_key, parent) => parent !== 'section' });
    v.part('row', 'heading')!.focus();
    await v.keys('Space', 'ArrowDown');
    await v.settle();
    expect(v.part('row', 'heading')!.hasAttribute('data-blocked')).toBe(true);
    expect(v.announced.at(-1)).toMatch(/Can't drop here/);
    await v.keys('Space');
    expect(v.state.rows).toEqual(rows);
  });

  it('a click selects, Mod adds, Shift selects a range', async () => {
    const v = open();
    await v.click(v.part('row', 'heading')!);
    expect(v.state.selected).toEqual(['heading']);
    v.part('row', 'image')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    );
    expect(v.state.selected).toEqual(['heading', 'image']);
    v.part('row', 'section')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    expect(v.state.selected).toEqual([
      'section',
      'section:children',
      'paragraph',
      'image',
    ]);
  });

  it('the toggle opens and closes a branch', async () => {
    view = mount(
      blockOutline,
      { defaultRows: rows, defaultExpanded: ['section'] },
      `<root aria-label="Outline"><row value="section">Section<toggle value="section"></toggle></row><row value="section:children">Content</row><instructions>Hint</instructions></root>`,
    );
    await view.click(view.part('toggle', 'section')!);
    expect(view.state.expanded).toEqual([]);
  });

  it('finds a row by typing its name', async () => {
    const v = open();
    v.part('row', 'heading')!.focus();
    await v.type('im');
    expect(document.activeElement).toBe(v.part('row', 'image'));
    expect(v.state.selected).toEqual(['image']);
  });

  it('Shift extends from where the selection started, both ways', async () => {
    const v = open();
    v.part('row', 'image')!.focus();
    await v.keys('ArrowUp', 'ArrowDown');
    await v.keys('Shift+ArrowUp', 'Shift+ArrowUp');
    expect(v.state.selected).toEqual([
      'section:children',
      'paragraph',
      'image',
    ]);
    await v.keys('Shift+ArrowDown');
    expect(v.state.selected).toEqual(['paragraph', 'image']);
    const stops = [...v.root.querySelectorAll('[tabindex="0"]')];
    expect(stops).toEqual([document.activeElement]);
  });

  it('Mod with an arrow moves focus only, Mod+Space adds, Mod+A selects all', async () => {
    const v = open();
    v.part('row', 'heading')!.focus();
    await v.keys('ArrowDown', 'ArrowUp');
    expect(v.state.selected).toEqual(['heading']);
    await v.keys('Control+ArrowDown', 'Control+ArrowDown', 'Control+ArrowDown');
    expect(document.activeElement).toBe(v.part('row', 'paragraph'));
    expect(v.state.selected).toEqual(['heading']);
    await v.keys('Control+Space');
    expect(v.state.selected).toEqual(['heading', 'paragraph']);
    await v.keys('Control+a');
    expect(v.state.selected).toEqual(rows.map((row) => row.key));
  });

  it('star opens every sibling branch', async () => {
    const v = open({ defaultExpanded: [] });
    v.part('row', 'heading')!.focus();
    await v.keys('*');
    expect(v.state.expanded).toEqual(['section']);
  });

  it('keys on a control inside a row stay with the control', async () => {
    view = mount(
      blockOutline,
      { defaultRows: rows },
      `<root aria-label="Outline"><row value="heading">Heading<button>Act</button></row><row value="section">Section</row><instructions>i</instructions></root>`,
    );
    view.root.querySelector('button')!.focus();
    await view.keys('Space', 'ArrowDown');
    expect(view.state.moving).toBeNull();
    expect(view.state.selected).toEqual([]);
  });

  it('refuses unknown blocks and lists every block for agents', () => {
    const v = open({
      defaultExpanded: [],
      labels: { paragraph: 'Paragraph: Hi' },
    });
    expect(() => v.api.select('footer')).toThrow(/No block "footer"/);
    expect(v.api.items()).toContainEqual({
      value: 'paragraph',
      label: 'Paragraph: Hi',
    });
  });

  it('works right to left', async () => {
    await expect(
      checkDirection(
        blockOutline,
        {
          defaultRows: rows.slice(1),
          defaultExpanded: [],
          fixed: ['section:children'],
        },
        `<root aria-label="Outline"><row value="section">Section</row><row value="section:children">Content</row><row value="paragraph">Paragraph</row><row value="image">Image</row><instructions>i</instructions></root>`,
      ),
    ).resolves.toBeUndefined();
  });

  it('renders on the server', () => {
    expect(() =>
      checkServer(
        blockOutline,
        { defaultRows: rows, fixed: ['section:children'] },
        markup,
      ),
    ).not.toThrow();
  });
});
