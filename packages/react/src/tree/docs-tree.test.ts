import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  diffSets,
  exportedSymbols,
  mentionsToken,
  parseSourceFile,
  readDoc,
} from '../test-utils/docs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TREE_MDX = 'reference/react-tree.mdx';

/** Names a kernel module declares with `export` (functions, constants, types). */
function declaredExports(file: string): string[] {
  const names: string[] = [];
  for (const node of parseSourceFile(file).statements) {
    const exported = ts.canHaveModifiers(node)
      ? ts
          .getModifiers(node)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!exported) continue;
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name
    ) {
      names.push(node.name.text);
    }
  }
  return names;
}

function undocumented(symbols: string[], doc: string): string[] {
  expect(symbols.length).toBeGreaterThan(2);
  return diffSets(
    symbols,
    symbols.filter((s) => mentionsToken(doc, s)),
  ).undocumented;
}

describe('docs coverage: react tree', () => {
  it('documents every export of the tree and its kernel', () => {
    const doc = readDoc(TREE_MDX);
    expect(doc.length).toBeGreaterThan(500);
    const missing = [
      ...undocumented(
        exportedSymbols(parseSourceFile(path.join(HERE, 'index.ts'))),
        doc,
      ),
      ...['drop', 'rows', 'typeahead'].flatMap((name) =>
        undocumented(
          declaredExports(path.join(HERE, 'core', `${name}.ts`)),
          doc,
        ),
      ),
    ];
    expect(
      missing,
      `exports missing from ${TREE_MDX}: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
