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
const BARREL = path.join(HERE, 'index.ts');
const MEDIA_MDX = 'reference/react-media.mdx';
const CORE_MDX = 'reference/react-media-core.mdx';
/** The modules `media/core/index.ts` re-exports with `export *`. */
const CORE_MODULES = [
  'announcer',
  'bulk',
  'detail',
  'downloads',
  'drag',
  'errors',
  'filter',
  'folders',
  'image-edit',
  'image-field',
  'intake',
  'layout',
  'marquee',
  'picker',
  'preview',
  'registry',
  'selection',
  'store',
  'touch',
  'typeahead',
  'types',
  'zip',
];

/** Names a module declares with `export` (functions, constants, types). */
function declaredExports(sourceFile: ts.SourceFile): string[] {
  const names: string[] = [];
  for (const node of sourceFile.statements) {
    const exported = ts.canHaveModifiers(node)
      ? ts
          .getModifiers(node)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    ) {
      for (const spec of node.exportClause.elements) names.push(spec.name.text);
    }
    if (!exported) continue;
    if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isInterfaceDeclaration(node)) &&
      node.name
    ) {
      names.push(node.name.text);
    }
  }
  return names;
}

describe('docs coverage: react media', () => {
  it('documents every export from the media barrel', () => {
    const sourceFile = parseSourceFile(BARREL);
    const symbols = exportedSymbols(sourceFile);
    const doc = readDoc(MEDIA_MDX);

    expect(symbols.length).toBeGreaterThan(20);
    expect(doc.length).toBeGreaterThan(500);

    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );

    expect(
      undocumented,
      `exports missing from ${MEDIA_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('documents every export of the media core subpath', () => {
    const symbols = [
      ...new Set(
        CORE_MODULES.flatMap((name) =>
          declaredExports(
            parseSourceFile(path.join(HERE, 'core', `${name}.ts`)),
          ),
        ),
      ),
    ];
    const doc = readDoc(CORE_MDX);
    expect(symbols.length).toBeGreaterThan(100);
    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );
    expect(
      undocumented,
      `exports missing from ${CORE_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});
