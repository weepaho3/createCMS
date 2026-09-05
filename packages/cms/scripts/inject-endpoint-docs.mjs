// Post-build .d.ts doctor: re-injects endpoint-method JSDoc that rollup-plugin-dts
// drops when it tree-shakes a route factory and inlines its inferred return type
// into createCollectionEndpoints (a verified cross-file-inlining limitation —
// raw `tsc --declaration` preserves these; the dts bundler does not).
//
// Source of truth = the JSDoc on each `<method>: createCMSEndpoint(...)` property
// in the route factories. We extract those and re-attach them to the matching
// `<method>: ...Endpoint<...>` property signatures in every emitted declaration,
// so the doc reaches `cmsClient.<ns>.<method>` autocomplete via the (homomorphic,
// doc-preserving) EndpointCaller mapping. Idempotent; safe to re-run.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const DIST = path.join(root, 'dist');

// ---------------------------------------------------------------------------
// 1. Extract method -> raw JSDoc block from the route-factory source files.
// ---------------------------------------------------------------------------
function collectSourceFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'test') continue;
      collectSourceFiles(p, acc);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
      acc.push(p);
    }
  }
  return acc;
}

const docByMethod = new Map();
const collisions = [];

for (const file of collectSourceFiles(SRC)) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('createCMSEndpoint(')) continue;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'createCMSEndpoint'
    ) {
      const name = node.name.text;
      const ranges =
        ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
      const jsdoc = ranges
        .filter((r) => text.slice(r.pos, r.pos + 3) === '/**')
        .map((r) => text.slice(r.pos, r.end))
        .pop();
      if (jsdoc) {
        if (docByMethod.has(name) && docByMethod.get(name) !== jsdoc) {
          collisions.push(name);
        }
        docByMethod.set(name, jsdoc);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

if (collisions.length) {
  console.warn(
    `[inject-endpoint-docs] WARNING: method names with conflicting docs: ${[...new Set(collisions)].join(', ')}`,
  );
}

// ---------------------------------------------------------------------------
// 2. Inject into every emitted declaration file.
// ---------------------------------------------------------------------------
function collectDtsFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectDtsFiles(p, acc);
    else if (e.name.endsWith('.d.ts') || e.name.endsWith('.d.cts')) acc.push(p);
  }
  return acc;
}

function reindent(jsdoc, indent) {
  // jsdoc is a raw `/** ... */` block authored at 4-space indent; re-indent each
  // line to the target property's indent.
  const lines = jsdoc.split('\n');
  return lines
    .map((line, i) => {
      if (i === 0) return indent + line.trimStart();
      return indent + ' ' + line.trim(); // ` * ...` / ` */`
    })
    .join('\n');
}

let filesTouched = 0;
let injected = 0;

for (const dtsFile of collectDtsFiles(DIST)) {
  let text = fs.readFileSync(dtsFile, 'utf8');
  const sf = ts.createSourceFile(dtsFile, text, ts.ScriptTarget.Latest, true);

  const edits = []; // { pos, comment }
  const visit = (node) => {
    if (
      ts.isPropertySignature(node) &&
      node.name &&
      ts.isIdentifier(node.name) &&
      docByMethod.has(node.name.text) &&
      node.type
    ) {
      const typeText = node.type.getText(sf);
      const isEndpoint = /(^|\.)Endpoint</.test(typeText);
      const hasDoc =
        (ts.getJSDocCommentsAndTags(node) ?? []).length > 0 ||
        (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []).some(
          (r) => text.slice(r.pos, r.pos + 3) === '/**',
        );
      if (isEndpoint && !hasDoc) {
        const nameStart = node.name.getStart(sf);
        const lineStart = text.lastIndexOf('\n', nameStart) + 1;
        const indent = (text.slice(lineStart).match(/^[ \t]*/) || [''])[0];
        edits.push({
          pos: lineStart,
          comment: reindent(docByMethod.get(node.name.text), indent) + '\n',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length === 0) continue;
  edits.sort((a, b) => b.pos - a.pos); // apply bottom-up
  for (const e of edits)
    text = text.slice(0, e.pos) + e.comment + text.slice(e.pos);
  fs.writeFileSync(dtsFile, text);
  filesTouched++;
  injected += edits.length;
}

console.log(
  `[inject-endpoint-docs] ${docByMethod.size} method docs from source; injected ${injected} into ${filesTouched} declaration file(s).`,
);
