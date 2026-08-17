import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '../..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');

export const DOCS_ROOT = path.join(
  REPO_ROOT,
  'apps',
  'docs',
  'content',
  'docs',
);

export function docPath(relative: string): string {
  return path.join(DOCS_ROOT, relative);
}

export function readDoc(relative: string): string {
  const file = docPath(relative);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Docs page not found: ${relative} (resolved to ${file}). ` +
        `If the page moved, update the docs-coverage test that reads it.`,
    );
  }
  return fs.readFileSync(file, 'utf8');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionsToken(text: string, token: string): boolean {
  return new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(token)}(?![A-Za-z0-9_$])`,
  ).test(text);
}

export function parseSourceFile(absolutePath: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function addObjectNamespace(
  names: Set<string>,
  name: string,
  node: ts.ObjectLiteralExpression,
): void {
  names.add(name);
  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop)) {
      if (ts.isIdentifier(prop.name)) {
        names.add(`${name}.${prop.name.text}`);
      } else if (ts.isStringLiteral(prop.name)) {
        names.add(`${name}.${prop.name.text}`);
      }
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      names.add(`${name}.${prop.name.text}`);
    }
  }
}

function collectExportSpecifiers(
  names: Set<string>,
  clause: ts.NamedExports,
): void {
  for (const spec of clause.elements) {
    if (spec.name.text === 'default') {
      throw new Error(
        'Default export found in barrel; exportedSymbols does not support default exports.',
      );
    }
    names.add(spec.name.text);
  }
}

export function exportedSymbols(sourceFile: ts.SourceFile): string[] {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        collectExportSpecifiers(names, node.exportClause);
      }
    }

    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            names.add(decl.name.text);
            if (
              decl.initializer &&
              ts.isObjectLiteralExpression(decl.initializer)
            ) {
              addObjectNamespace(names, decl.name.text, decl.initializer);
            }
          }
        }
      }
    }

    if (ts.isFunctionDeclaration(node) && node.name) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported) names.add(node.name.text);
    }

    if (ts.isClassDeclaration(node) && node.name) {
      const isExported = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (isExported) names.add(node.name.text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  const sorted = [...names].sort();
  if (sorted.length < 10) {
    throw new Error(
      `Extracted only ${sorted.length} exported symbols from ${sourceFile.fileName}; ` +
        `the AST walk is wrong (expected at least 10).`,
    );
  }
  return sorted;
}

export function diffSets(
  source: Iterable<string>,
  documented: Iterable<string>,
): { undocumented: string[]; stale: string[] } {
  const inSource = new Set(source);
  const inDocs = new Set(documented);
  return {
    undocumented: [...inSource].filter((k) => !inDocs.has(k)).sort(),
    stale: [...inDocs].filter((k) => !inSource.has(k)).sort(),
  };
}
