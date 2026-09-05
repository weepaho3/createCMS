/**
 * Shared plumbing for the docs-coverage tests (`docs-property-types`,
 * `docs-error-codes`, `docs-endpoints`, `docs-config`).
 *
 * Those tests pin the documentation against the code the same way
 * `core/routes/test/endpoint-authz-contract.test.ts` pins the authorization
 * contract: the SOURCE is the truth and the MDX is checked against it, in
 * both directions. An undocumented option is a gap; a documented option that
 * no longer exists sends a reader down a path that does not exist.
 *
 * Three pieces live here: path resolution from this package into `apps/docs`
 * (cwd-independent), MDX readers (a table parser and an `<APIMethod />`
 * attribute parser), and TS-AST readers for the type aliases that are the
 * source of truth for the define/configuration pages.
 *
 * Everything that extracts a set throws when it extracts NOTHING: a docs test
 * that silently compares two empty sets passes forever while the docs rot.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, '../..');
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '../..');

/** `apps/docs/content/docs`, the Fumadocs content root. */
export const DOCS_ROOT = path.join(
  REPO_ROOT,
  'apps',
  'docs',
  'content',
  'docs',
);

/** Absolute path of a source file, given its path relative to `src/`. */
export function sourcePath(relative: string): string {
  return path.join(PACKAGE_ROOT, 'src', relative);
}

/** Absolute path of a source file inside the shared @createcms/schema package
 *  (`packages/schema/src/<relative>`), for docs tests that pin type aliases
 *  which moved there. */
export function schemaSourcePath(relative: string): string {
  return path.join(REPO_ROOT, 'packages/schema/src', relative);
}

/** Absolute path of a docs page, given its path relative to {@link DOCS_ROOT}. */
export function docPath(relative: string): string {
  return path.join(DOCS_ROOT, relative);
}

/**
 * Reads one docs page. Throws with the resolved path when it is missing: a
 * renamed page must fail the test loudly, not read as "nothing documented".
 */
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

/** Every `.mdx` page under a docs directory, as `{ relative, content }`. */
export function readDocDir(
  relativeDir: string,
): { relative: string; content: string }[] {
  const root = docPath(relativeDir);
  if (!fs.existsSync(root)) {
    throw new Error(`Docs directory not found: ${relativeDir} (${root}).`);
  }
  const out: { relative: string; content: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.mdx')) {
        out.push({
          relative: path.relative(DOCS_ROOT, p),
          content: fs.readFileSync(p, 'utf8'),
        });
      }
    }
  };
  walk(root);
  if (out.length === 0) {
    throw new Error(`No .mdx pages found under ${relativeDir} (${root}).`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Token-exact matching
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `text` mentions `token` as a whole identifier.
 *
 * Substring matching is the trap this exists to avoid: `getRoot` occurs inside
 * `getRootHistory`, `min` inside `minLength`, `list` inside `listRoots`. A
 * substring check would count each of those as documented and the test would
 * pass while the real thing is missing.
 */
export function mentionsToken(text: string, token: string): boolean {
  return new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(token)}(?![A-Za-z0-9_$])`,
  ).test(text);
}

/** Inline-code spans of a string, in order, without their backticks. */
export function codeTokens(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
}

// ---------------------------------------------------------------------------
// MDX tables
// ---------------------------------------------------------------------------

export type MdxTable = {
  /** Text of the nearest preceding `#` heading (anchor suffix stripped). */
  heading: string;
  header: string[];
  rows: string[][];
};

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

function isSeparatorLine(line: string): boolean {
  return /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(line);
}

/**
 * Splits one markdown table row into trimmed cells. Pipes escaped as `\|`
 * (used by the configuration page for union types like `'a' \| 'b'`) belong to
 * the cell, not to the row.
 */
function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/**
 * Every markdown table in an MDX page, tagged with the heading it sits under.
 * Tables inside fenced code blocks are ignored (they are examples, not
 * documentation of record).
 */
export function mdxTables(markdown: string): MdxTable[] {
  const lines = markdown.split('\n');
  const tables: MdxTable[] = [];
  let heading = '';
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;

    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      heading = (headingMatch[1] as string).replace(/\s*\[#[^\]]*\]\s*$/, '');
      continue;
    }

    if (!isTableLine(line)) continue;
    if (!isSeparatorLine(lines[i + 1] ?? '')) continue;

    const header = splitRow(line);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length && isTableLine(lines[j] as string); j++) {
      rows.push(splitRow(lines[j] as string));
    }
    tables.push({ heading, header, rows });
    i = j - 1;
  }

  return tables;
}

/**
 * The single table on a page whose heading and header row match. Throws when
 * zero or more than one match: either way the test's assumption about the
 * page's shape is stale and must be fixed, not silently skipped.
 */
export function findTable(
  markdown: string,
  match: { heading?: string; header: string[] },
): MdxTable {
  const all = mdxTables(markdown);
  const hits = all.filter(
    (t) =>
      (match.heading === undefined || t.heading === match.heading) &&
      t.header.length === match.header.length &&
      match.header.every((cell, i) => t.header[i] === cell),
  );
  if (hits.length !== 1) {
    const seen = all
      .map((t) => `  under "${t.heading}": [${t.header.join(' | ')}]`)
      .join('\n');
    throw new Error(
      `Expected exactly 1 table with header [${match.header.join(' | ')}]` +
        (match.heading === undefined
          ? ''
          : ` under heading "${match.heading}"`) +
        `, found ${hits.length}. Tables on this page:\n${seen}`,
    );
  }
  return hits[0] as MdxTable;
}

// ---------------------------------------------------------------------------
// `<APIMethod />` blocks
// ---------------------------------------------------------------------------

export type APIMethodBlock = {
  /** Docs page the block was found on, relative to {@link DOCS_ROOT}. */
  page: string;
  /** String attributes written as `name="value"` on their own line. */
  attrs: Record<string, string>;
  /** Valueless boolean attributes (`public`, `anonymousRead`). */
  flags: Set<string>;
};

/**
 * Parses the `<APIMethod ... />` blocks out of MDX pages.
 *
 * The component (`apps/docs/src/components/api-method.tsx`) is the structured
 * record of which endpoints are documented and under which permission labels,
 * so the endpoint test reads it rather than grepping prose. A block ends at
 * the first line ending in `/>`, and attributes are read only from lines of
 * the form `name="value"` / bare `name` at exactly one indent level, which is
 * what keeps the nested `params={{ ... }}` / `returns={{ ... }}` object
 * literals from being mistaken for attributes.
 */
export function parseAPIMethods(
  pages: { relative: string; content: string }[],
): APIMethodBlock[] {
  const blocks: APIMethodBlock[] = [];

  for (const { relative, content } of pages) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*<APIMethod\b/.test(lines[i] as string)) continue;

      const attrs: Record<string, string> = {};
      const flags = new Set<string>();
      let closed = false;

      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j] as string;
        const pair = /^\s{2}([A-Za-z][A-Za-z0-9]*)="([^"]*)"\s*$/.exec(line);
        if (pair) attrs[pair[1] as string] = pair[2] as string;
        else {
          const flag = /^\s{2}([A-Za-z][A-Za-z0-9]*)\s*$/.exec(line);
          if (flag) flags.add(flag[1] as string);
        }
        if (/(^|\s)\/>\s*$/.test(line)) {
          closed = true;
          i = j;
          break;
        }
      }

      if (!closed) {
        throw new Error(
          `Unterminated <APIMethod> block in ${relative} at line ${i + 1}. ` +
            `The parser expects a line containing exactly "/>".`,
        );
      }
      blocks.push({ page: relative, attrs, flags });
    }
  }

  if (blocks.length === 0) {
    throw new Error(
      'No <APIMethod> blocks parsed. The component or its formatting changed — ' +
        'fix the parser in test-utils/docs.ts rather than letting the endpoint ' +
        'coverage test pass on an empty set.',
    );
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// TypeScript AST
// ---------------------------------------------------------------------------

/** Parses a source file for AST reads. No type checker, no program — syntax only. */
export function parseSourceFile(absolutePath: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    fs.readFileSync(absolutePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function findTypeAlias(
  sourceFile: ts.SourceFile,
  name: string,
): ts.TypeAliasDeclaration {
  let found: ts.TypeAliasDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name)
      found = node;
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!found) {
    throw new Error(
      `Type alias \`${name}\` not found in ${sourceFile.fileName}. ` +
        `It was renamed or moved — update the docs-coverage test that reads it.`,
    );
  }
  return found;
}

export type TypeMember = { name: string; optional: boolean };

function membersOfTypeNode(
  node: ts.TypeNode,
  sourceFile: ts.SourceFile,
  seen: Set<string>,
): TypeMember[] {
  if (ts.isParenthesizedTypeNode(node)) {
    return membersOfTypeNode(node.type, sourceFile, seen);
  }
  if (ts.isIntersectionTypeNode(node)) {
    return node.types.flatMap((t) => membersOfTypeNode(t, sourceFile, seen));
  }
  if (ts.isTypeLiteralNode(node)) {
    return node.members.flatMap((member) => {
      if (!ts.isPropertySignature(member) || !member.name) return [];
      if (!ts.isIdentifier(member.name) && !ts.isStringLiteral(member.name)) {
        return [];
      }
      return [
        {
          name: member.name.text,
          optional: member.questionToken !== undefined,
        },
      ];
    });
  }
  // A bare alias reference (`... & StringConstraints`) is followed once, so a
  // constraint bag extracted into its own type still contributes its fields.
  if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
    const referenced = node.typeName.text;
    if (seen.has(referenced)) return [];
    seen.add(referenced);
    const alias = findTypeAlias(sourceFile, referenced);
    return membersOfTypeNode(alias.type, sourceFile, seen);
  }
  return [];
}

/**
 * The property members of a type alias, the object-literal ones. For an
 * intersection (`Base & (T extends 'x' ? ... : {})`) this returns the members
 * of every plain object constituent; the conditional arms are read separately
 * by {@link conditionalExtras}.
 */
export function typeMembers(
  sourceFile: ts.SourceFile,
  typeName: string,
): TypeMember[] {
  const members = membersOfTypeNode(
    findTypeAlias(sourceFile, typeName).type,
    sourceFile,
    new Set([typeName]),
  );
  if (members.length === 0) {
    throw new Error(
      `Extracted 0 members from \`${typeName}\` — the type's shape changed and ` +
        `the AST reader in test-utils/docs.ts no longer understands it.`,
    );
  }
  return members;
}

/** Just the names, sorted. */
export function typeMemberNames(
  sourceFile: ts.SourceFile,
  typeName: string,
): string[] {
  return typeMembers(sourceFile, typeName)
    .map((m) => m.name)
    .sort();
}

function literalStrings(node: ts.TypeNode): string[] {
  if (ts.isUnionTypeNode(node)) return node.types.flatMap(literalStrings);
  if (ts.isParenthesizedTypeNode(node)) return literalStrings(node.type);
  if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
    return [node.literal.text];
  }
  return [];
}

/**
 * The per-type extra config a property spec adds conditionally: walks the
 * `T extends 'select' ? { options } : {}` arms of `BlockPropertySpec` (and the
 * equivalent arms inside the `ListElementSpec` mapped type) and returns
 * `'select' -> ['options']`, `'string' -> ['minLength', ...]`, and so on.
 *
 * This is what makes "a new field type gained a required extra option" a test
 * failure instead of a silent docs gap.
 */
export function conditionalExtras(
  sourceFile: ts.SourceFile,
  typeName: string,
): Map<string, string[]> {
  const out = new Map<string, string[]>();

  const walk = (node: ts.TypeNode) => {
    if (ts.isParenthesizedTypeNode(node)) return walk(node.type);
    if (ts.isIntersectionTypeNode(node)) {
      node.types.forEach(walk);
      return;
    }
    // `{ [K in ListElementType]: ... }[ListElementType]`: descend to the value.
    if (ts.isIndexedAccessTypeNode(node)) return walk(node.objectType);
    if (ts.isMappedTypeNode(node) && node.type) return walk(node.type);
    if (!ts.isConditionalTypeNode(node)) return;

    const fields = membersOfTypeNode(
      node.trueType,
      sourceFile,
      new Set([typeName]),
    ).map((m) => m.name);
    for (const key of literalStrings(node.extendsType)) {
      out.set(key, [...(out.get(key) ?? []), ...fields]);
    }
    // Conditionals can nest in the false arm; keep walking both.
    walk(node.trueType);
    walk(node.falseType);
  };

  walk(findTypeAlias(sourceFile, typeName).type);

  if (out.size === 0) {
    throw new Error(
      `Found no conditional extras on \`${typeName}\` — the type's shape ` +
        `changed and the AST reader in test-utils/docs.ts no longer understands it.`,
    );
  }
  return out;
}

/** The verbatim source text of a type alias's right-hand side. */
export function typeAliasText(
  sourceFile: ts.SourceFile,
  typeName: string,
): string {
  return findTypeAlias(sourceFile, typeName).type.getText(sourceFile);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Both directions of a coverage comparison, as sorted arrays ready to hand to
 * `expect(...).toEqual([])` with a message.
 */
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
