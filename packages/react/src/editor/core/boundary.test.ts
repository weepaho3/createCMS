import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CORE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_ROOT = path.dirname(CORE_ROOT);

const FORBIDDEN_PACKAGES = [
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^@tiptap\//,
  /^yjs$/,
  /^y-/,
  /^@createcms\/react(?:\/|$)/,
  /^@createcms\/schema(?:\/|$)/,
];

const CMS_ROOT = path.join(EDITOR_ROOT, 'cms');
/** The entries the adapter may import from the other editor layers. */
const PUBLIC_ENTRIES = new Set([
  path.join(EDITOR_ROOT, 'core'),
  path.join(EDITOR_ROOT, 'core', 'index'),
  path.join(EDITOR_ROOT, 'canvas'),
  path.join(EDITOR_ROOT, 'canvas', 'index'),
  EDITOR_ROOT,
  path.join(EDITOR_ROOT, 'index'),
]);

function sourceFiles(dir: string, includeTests = false): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, includeTests));
    else if (
      /\.tsx?$/.test(entry.name) &&
      (includeTests || !/\.test\.tsx?$/.test(entry.name))
    ) {
      out.push(full);
    }
  }
  return out;
}

function importSpecifiers(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specs.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** Violations of the core boundary for one file, given its source text. */
function coreViolations(file: string, text: string): string[] {
  const rel = path.relative(CORE_ROOT, file);
  const out: string[] = [];
  for (const spec of importSpecifiers(file, text)) {
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      if (path.relative(CORE_ROOT, target).startsWith('..')) {
        out.push(`${rel}: "${spec}" leaves src/editor/core`);
      }
    } else if (FORBIDDEN_PACKAGES.some((re) => re.test(spec))) {
      out.push(`${rel}: imports "${spec}"`);
    }
  }
  if (/^\s*['"]use (?:client|server)['"]/.test(text)) {
    out.push(`${rel}: carries a directive`);
  }
  return out;
}

/** Imports from the editor into the media library. */
function mediaViolations(file: string, text: string): string[] {
  const media = path.resolve(EDITOR_ROOT, '..', 'media');
  return importSpecifiers(file, text)
    .filter((spec) =>
      spec.startsWith('.')
        ? !path
            .relative(media, path.resolve(path.dirname(file), spec))
            .startsWith('..')
        : spec === '@createcms/react/media',
    )
    .map((spec) => `${path.relative(EDITOR_ROOT, file)}: imports "${spec}"`);
}

/** `@createcms/schema` imports outside the createcms adapter. */
function schemaViolations(file: string, text: string): string[] {
  if (!path.relative(CMS_ROOT, file).startsWith('..')) return [];
  return importSpecifiers(file, text)
    .filter((spec) => /^@createcms\/schema(?:\/|$)/.test(spec))
    .map((spec) => `${path.relative(EDITOR_ROOT, file)}: imports "${spec}"`);
}

/** Adapter imports into the other editor layers that bypass their public entries. */
function adapterViolations(file: string, text: string): string[] {
  return importSpecifiers(file, text)
    .filter((spec) => {
      if (!spec.startsWith('.')) return false;
      const target = path.resolve(path.dirname(file), spec);
      if (!path.relative(CMS_ROOT, target).startsWith('..')) return false;
      return !PUBLIC_ENTRIES.has(target);
    })
    .map((spec) => `${path.relative(EDITOR_ROOT, file)}: imports "${spec}"`);
}

describe('editor/core import boundary', () => {
  it('core imports no React, CRDT, rich text library or other editor layer', () => {
    const problems = sourceFiles(CORE_ROOT).flatMap((file) =>
      coreViolations(file, fs.readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('the editor imports nothing from the media library', () => {
    const problems = sourceFiles(EDITOR_ROOT).flatMap((file) =>
      mediaViolations(file, fs.readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('only the createcms adapter imports @createcms/schema', () => {
    const problems = sourceFiles(EDITOR_ROOT, true).flatMap((file) =>
      schemaViolations(file, fs.readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('the createcms adapter uses the public entries of the other layers', () => {
    const problems = sourceFiles(CMS_ROOT).flatMap((file) =>
      adapterViolations(file, fs.readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('reports forbidden imports', () => {
    const file = path.join(CORE_ROOT, 'store', 'probe.ts');
    expect(
      coreViolations(
        file,
        [
          "'use client';",
          "import * as React from 'react';",
          "import { createPortal } from 'react-dom';",
          "import { Editor } from '@tiptap/core';",
          "import * as Y from 'yjs';",
          "import { isHTMLElement } from '../../dom';",
          "export type T = import('@createcms/react/editor').EditorProps;",
          "import type { BlockTreeNode } from '@createcms/schema';",
          "import { ops } from './ops';",
          "import { fields } from '../schema/fields';",
        ].join('\n'),
      ),
    ).toEqual([
      'store/probe.ts: imports "react"',
      'store/probe.ts: imports "react-dom"',
      'store/probe.ts: imports "@tiptap/core"',
      'store/probe.ts: imports "yjs"',
      'store/probe.ts: "../../dom" leaves src/editor/core',
      'store/probe.ts: imports "@createcms/react/editor"',
      'store/probe.ts: imports "@createcms/schema"',
      'store/probe.ts: carries a directive',
    ]);
    expect(
      mediaViolations(
        path.join(EDITOR_ROOT, 'canvas', 'probe.ts'),
        "import { MediaLibrary } from '../../media';",
      ),
    ).toEqual(['canvas/probe.ts: imports "../../media"']);
    expect(
      schemaViolations(
        path.join(EDITOR_ROOT, 'canvas', 'probe.ts'),
        "import type { BlockTreeNode } from '@createcms/schema';",
      ),
    ).toEqual(['canvas/probe.ts: imports "@createcms/schema"']);
    expect(
      schemaViolations(
        path.join(CMS_ROOT, 'probe.ts'),
        "import type { BlockTreeNode } from '@createcms/schema';",
      ),
    ).toEqual([]);
    expect(
      adapterViolations(
        path.join(CMS_ROOT, 'probe.ts'),
        [
          "import { createEditorStore } from '../core';",
          "import { Canvas } from '../canvas';",
          "import { Editor } from '../index';",
          "import { getPlacement } from '../core/schema';",
          "import { useFields } from '../hooks';",
          "import { fromCollection } from './mapping';",
        ].join('\n'),
      ),
    ).toEqual([
      'cms/probe.ts: imports "../core/schema"',
      'cms/probe.ts: imports "../hooks"',
    ]);
  });
});
