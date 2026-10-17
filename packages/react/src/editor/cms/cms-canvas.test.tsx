// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../core';

import { Canvas } from '../canvas';
import { Editor, useEditorContext } from '../index';
import { cmsCanvasComponents } from './canvas';
import { fromCollection } from './mapping';
import {
  featuredRef,
  heroBlocks,
  heroDoc,
  heroSchema,
  PublishedHeroTree,
} from './test/hero-fixtures';

afterEach(cleanup);

const STRIP_ATTRS = [
  'data-editor-block',
  'data-editor-field',
  'data-editor-slot',
  'data-editor-canvas',
  'data-editor-readonly',
  'data-interactive',
  'data-dragging',
  'data-editing',
  'data-unresolved',
  'data-testid',
  'inert',
] as const;

function strippedHtml(host: Element): string {
  const clone = host.cloneNode(true) as Element;
  for (const el of [clone, ...clone.querySelectorAll('*')]) {
    for (const attr of STRIP_ATTRS) el.removeAttribute(attr);
  }
  return clone.innerHTML;
}

const schema = fromCollection(heroSchema);
const components = cmsCanvasComponents(heroBlocks);

function renderHero(resolveReference: (value: unknown) => unknown) {
  const bag: { store: EditorStore | null } = { store: null };
  function Probe() {
    bag.store = useEditorContext('Probe').store;
    return null;
  }
  const utils = render(
    <Editor.Root schema={schema} defaultValue={heroDoc}>
      <Probe />
      <Canvas.Root
        data-testid="canvas"
        components={components}
        resolve={{ reference: resolveReference }}
      />
    </Editor.Root>,
  );
  return { ...utils, host: utils.getByTestId('canvas'), store: bag.store! };
}

describe('cmsCanvasComponents', () => {
  it('renders like the published page once anchors are stripped', () => {
    const { host } = renderHero(() => featuredRef);
    const published = render(
      <div>
        <PublishedHeroTree />
      </div>,
    );
    expect(strippedHtml(host)).toBe(
      strippedHtml(published.container.firstElementChild!),
    );
  });

  it('hands the reference resolver the editor value', () => {
    const seen: unknown[] = [];
    renderHero((value) => {
      seen.push(value);
      return featuredRef;
    });
    expect(seen).toEqual([{ id: 'item-root' }]);
  });

  it('renders referenced blocks readonly and unselectable', () => {
    const { host, store } = renderHero(() => featuredRef);
    const readonly = host.querySelector('[data-editor-readonly][inert]');
    expect(readonly?.textContent).toBe('Featured');
    const inner = readonly?.querySelector('article');
    expect(inner?.hasAttribute('data-editor-block')).toBe(false);
    inner!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getSession().selection[0] ?? null).toBeNull();
  });

  it('leaves an unresolved reference out of the properties', () => {
    const { host } = renderHero(() => undefined);
    expect(host.querySelector('[data-editor-readonly]')).toBeNull();
    expect(
      host
        .querySelector('[data-editor-block="hero1"]')
        ?.getAttribute('data-unresolved'),
    ).toBe('');
  });
});
