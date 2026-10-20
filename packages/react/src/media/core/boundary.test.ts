import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CORE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(CORE_ROOT, '..', '..');

const FORBIDDEN_PACKAGES = [
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^@createcms\/react(?:\/|$)/,
  /^@createcms\/schema(?:\/|$)/,
];

/** The shared asset and upload types; erased at build time. */
const TYPE_ONLY_ALLOWED = new Set([
  path.join(SRC_ROOT, 'editor', 'cms', 'types'),
]);

/** The tree kernel: React-free too, with its own boundary test. */
const TREE_CORE = path.join(SRC_ROOT, 'tree', 'core');

function within(root: string, target: string): boolean {
  return !path.relative(root, target).startsWith('..');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

type Specifier = { text: string; typeOnly: boolean };

function importSpecifiers(file: string, text: string): Specifier[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specs: Specifier[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push({
        text: node.moduleSpecifier.text,
        typeOnly:
          node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword,
      });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push({
        text: node.moduleSpecifier.text,
        typeOnly: node.isTypeOnly,
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push({ text: node.arguments[0].text, typeOnly: false });
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      specs.push({ text: node.argument.literal.text, typeOnly: true });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

function coreViolations(file: string, text: string): string[] {
  const rel = path.relative(CORE_ROOT, file);
  const out: string[] = [];
  for (const spec of importSpecifiers(file, text)) {
    if (spec.text.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec.text);
      if (within(CORE_ROOT, target) || within(TREE_CORE, target)) continue;
      if (spec.typeOnly && TYPE_ONLY_ALLOWED.has(target)) continue;
      out.push(`${rel}: "${spec.text}" leaves src/media/core`);
    } else if (FORBIDDEN_PACKAGES.some((re) => re.test(spec.text))) {
      out.push(`${rel}: imports "${spec.text}"`);
    } else if (!spec.typeOnly) {
      out.push(`${rel}: imports the runtime dependency "${spec.text}"`);
    }
  }
  if (/^\s*['"]use (?:client|server)['"]/.test(text)) {
    out.push(`${rel}: carries a directive`);
  }
  return out;
}

describe('media/core import boundary', () => {
  it('imports no React, no other layer and no runtime dependency', () => {
    const problems = sourceFiles(CORE_ROOT).flatMap((file) =>
      coreViolations(file, fs.readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('reports forbidden imports', () => {
    expect(
      coreViolations(
        path.join(CORE_ROOT, 'probe.ts'),
        [
          "'use client';",
          "import * as React from 'react';",
          "import { createPortal } from 'react-dom';",
          "import { Media } from '../index';",
          "import { mergeProps } from '../../use-render';",
          "import { EDITOR } from '../../editor/cms/types';",
          "import type { CmsAssetListItem } from '../../editor/cms/types';",
          "import type { Foo } from 'some-types';",
          "import { nanoid } from 'nanoid';",
          "import { layout } from './layout';",
          "import { treeNavigate } from '../../tree/core/rows';",
          "import { TreeRoot } from '../../tree/tree';",
        ].join('\n'),
      ),
    ).toEqual([
      'probe.ts: imports "react"',
      'probe.ts: imports "react-dom"',
      'probe.ts: "../index" leaves src/media/core',
      'probe.ts: "../../use-render" leaves src/media/core',
      'probe.ts: "../../editor/cms/types" leaves src/media/core',
      'probe.ts: imports the runtime dependency "nanoid"',
      'probe.ts: "../../tree/tree" leaves src/media/core',
      'probe.ts: carries a directive',
    ]);
  });
});
