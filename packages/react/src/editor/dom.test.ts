// @vitest-environment happy-dom
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { isElement, isHTMLElement, isNode, viewOf } from './dom';

const EDITOR_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REALM_UNSAFE = /\binstanceof\s+(?:HTMLElement|Element|Node)\b/;

function editorSources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...editorSources(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.(?:test|type-check)\.tsx?$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('dom guards', () => {
  it('accepts html elements and rejects other values', () => {
    const div = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const text = document.createTextNode('x');

    expect(isHTMLElement(div)).toBe(true);
    expect(isHTMLElement(svg)).toBe(false);
    expect(isHTMLElement(text)).toBe(false);
    expect(isHTMLElement(null)).toBe(false);
    expect(isHTMLElement({ nodeType: 1 })).toBe(false);

    expect(isElement(svg)).toBe(true);
    expect(isElement(text)).toBe(false);

    expect(isNode(text)).toBe(true);
    expect(isNode(document)).toBe(true);
    expect(isNode(undefined)).toBe(false);
    expect(isNode('div')).toBe(false);
  });

  it('resolves the owning window of a node', () => {
    const div = document.createElement('div');
    expect(viewOf(div)).toBe(window);
    expect(viewOf(null)).toBeNull();
  });
});

describe('realm-safe editor sources', () => {
  it('has no instanceof HTMLElement, Element or Node checks', () => {
    const offenders = editorSources(EDITOR_ROOT)
      .filter((file) => REALM_UNSAFE.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(EDITOR_ROOT, file));
    expect(
      offenders,
      'use isHTMLElement/isElement/isNode from editor/dom.ts: instanceof is false for nodes in a same-origin iframe',
    ).toEqual([]);
  });
});
