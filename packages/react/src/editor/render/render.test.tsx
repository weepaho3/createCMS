// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RenderComponents } from './index';

import { makeDoc, storeSchema } from '../core/store/fixtures';
import { renderDocument } from './index';

const components: RenderComponents = {
  heading: ({ props, edit }) => <h2 {...edit.block}>{String(props.text)}</h2>,
  paragraph: ({ props }) => <p>{String(props.text)}</p>,
  section: ({ children }) => <section>{children}</section>,
};

describe('renderDocument', () => {
  it('renders a stored document without editing anchors', () => {
    const html = renderToStaticMarkup(
      <>{renderDocument(makeDoc(), components, { schema: storeSchema })}</>,
    );
    expect(html).toBe('<h2>Hello</h2><section><p>World</p></section>');
  });

  it('wraps blocks and renders unknown types through options', () => {
    const doc = makeDoc();
    doc.root.slots!.children!.push({ id: 'x1', type: 'widget', props: {} });
    const html = renderToStaticMarkup(
      <>
        {renderDocument(doc, components, {
          wrapBlock: (element, block) => (
            <div data-block={block.id}>{element}</div>
          ),
          unknown: (block) => <i>{block.type}</i>,
        })}
      </>,
    );
    expect(html).toContain('<div data-block="h1"><h2>Hello</h2></div>');
    expect(html).toContain('<i>widget</i>');
  });

  it('has no client directive and imports only react and the core', () => {
    const source = readFileSync(join(import.meta.dirname, 'index.ts'), 'utf8');
    expect(source).not.toContain("'use client'");
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const path of imports) {
      expect(path === 'react' || path?.startsWith('../core/')).toBe(true);
    }
    expect(React).toBeDefined();
  });
});
