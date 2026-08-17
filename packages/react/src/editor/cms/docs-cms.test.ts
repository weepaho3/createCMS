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
} from '../../test-utils/docs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(HERE, 'index.ts');
const ERRORS = path.join(HERE, 'errors.ts');
const CMS_MDX = 'reference/react-editor-cms.mdx';

const ERROR_CODES = [
  'HEAD_MISMATCH',
  'TYPE_MISMATCH',
  'BLOCK_NOT_ALLOWED_IN_PARENT',
  'PROTECTED_BRANCH',
  'COMMIT_MESSAGE_REQUIRED',
] as const;

function exportedConstNames(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const decl of node.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isStringLiteral(decl.initializer)
        ) {
          names.push(decl.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names.sort();
}

describe('docs coverage: react editor cms', () => {
  it('documents every export from the cms barrel', () => {
    const sourceFile = parseSourceFile(BARREL);
    const symbols = exportedSymbols(sourceFile);
    const doc = readDoc(CMS_MDX);

    expect(symbols.length).toBeGreaterThan(15);
    expect(doc.length).toBeGreaterThan(500);

    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );

    expect(
      undocumented,
      `exports missing from ${CMS_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('documents cms error code constants from errors.ts', () => {
    const errorsFile = parseSourceFile(ERRORS);
    const constNames = exportedConstNames(errorsFile);
    const doc = readDoc(CMS_MDX);

    expect(constNames.sort()).toEqual([...ERROR_CODES].sort());

    const missing = constNames.filter((name) => !mentionsToken(doc, name));
    expect(
      missing,
      `error codes missing from ${CMS_MDX}: ${missing.join(', ')}`,
    ).toEqual([]);

    expect(mentionsToken(doc, 'UNKNOWN')).toBe(true);
  });
});
