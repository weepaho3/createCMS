import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  console.error(`check-demo-guide: ${message}`);
  process.exit(1);
}

const mdx = read('content/docs/guides/visual-editor.mdx');

for (const required of [
  '/demo/editor/pages',
  '/demo/editor/email',
  'EditorShell',
  'EditorEmail',
  'cmsFields',
  'CmsSourcesProvider',
  '@createcms/react/editor',
]) {
  if (!mdx.includes(required)) {
    fail(`visual-editor.mdx is missing "${required}"`);
  }
}

const liveCanvas = read('src/app/demo/editor/pages/pages-live-canvas.tsx');
if (
  !mdx.includes('function PagesLiveCanvas') ||
  !mdx.includes('Canvas.Root') ||
  !liveCanvas.includes('function PagesLiveCanvas')
) {
  fail(
    'visual-editor.mdx must include PagesLiveCanvas and Canvas.Root from pages-live-canvas.tsx',
  );
}

const emailSplit = read('src/app/demo/editor/email/email-split.tsx');
if (
  !mdx.includes('renderEmailHtml') ||
  !mdx.includes('EditorEmail') ||
  !emailSplit.includes('renderEmailHtml')
) {
  fail(
    'visual-editor.mdx must include renderEmailHtml and EditorEmail from email-split.tsx',
  );
}

console.log('check-demo-guide: ok');
