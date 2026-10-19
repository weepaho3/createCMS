import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const CORE_ROOT = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [full]
      : [];
  });
}

/** Every module specifier a file imports or re-exports. */
function specifiers(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function violations(file: string, text: string): string[] {
  const rel = path.relative(CORE_ROOT, file);
  const out: string[] = [];
  for (const spec of specifiers(file, text)) {
    if (!spec.startsWith('.')) {
      out.push(`${rel}: imports "${spec}"`);
      continue;
    }
    const target = path.resolve(path.dirname(file), spec);
    if (path.relative(CORE_ROOT, target).startsWith('..')) {
      out.push(`${rel}: "${spec}" leaves src/tree/core`);
    }
  }
  if (/^\s*['"]use (?:client|server)['"]/.test(text)) {
    out.push(`${rel}: carries a directive`);
  }
  return out;
}

describe('tree/core import boundary', () => {
  it('imports nothing outside itself and carries no directive', () => {
    const problems = sourceFiles(CORE_ROOT).flatMap((file) =>
      violations(file, fs.readFileSync(file, 'utf8')),
    );
    expect(problems).toEqual([]);
  });

  it('reports forbidden imports', () => {
    expect(
      violations(
        path.join(CORE_ROOT, 'probe.ts'),
        [
          "'use client';",
          "import * as React from 'react';",
          "import { TreeRoot } from '../tree';",
          "import { dropInstruction } from './drop';",
        ].join('\n'),
      ),
    ).toEqual([
      'probe.ts: imports "react"',
      'probe.ts: "../tree" leaves src/tree/core',
      'probe.ts: carries a directive',
    ]);
  });
});
