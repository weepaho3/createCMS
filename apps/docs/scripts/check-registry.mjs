import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicR = path.join(root, 'public/r');

const ITEM_NAMES = [
  'editor-form',
  'editor-canvas',
  'editor-shell',
  'editor-email',
];

function readJson(name) {
  const filePath = path.join(publicR, name);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(
      `check-registry: failed to read ${filePath}: ${error.message}`,
    );
    process.exit(1);
  }
}

readJson('registry.json');

const items = ITEM_NAMES.map((name) => {
  const item = readJson(`${name}.json`);
  if (item.name !== name) {
    console.error(
      `check-registry: expected name "${name}", got "${item.name}"`,
    );
    process.exit(1);
  }
  if (item.type !== 'registry:ui') {
    console.error(
      `check-registry: expected type "registry:ui", got "${item.type}"`,
    );
    process.exit(1);
  }
  if (!Array.isArray(item.dependencies)) {
    console.error(`check-registry: ${name}.json missing dependencies array`);
    process.exit(1);
  }
  if (!item.dependencies.includes('@createcms/react')) {
    console.error(
      `check-registry: ${name}.json dependencies must include @createcms/react`,
    );
    process.exit(1);
  }
  return item;
});

const fileContents = items
  .flatMap((item) => item.files ?? [])
  .map((file) => file.content ?? '')
  .join('\n');

if (/<(Editor|Canvas)\.Root/.test(fileContents)) {
  console.error(
    'check-registry: registry output must not render Editor.Root or Canvas.Root',
  );
  process.exit(1);
}

const checks = [
  ['data-slot="editor-field"', 'editor-field slot'],
  ['cmsFields', 'cmsFields export'],
  ['data-slot="editor-overlay"', 'editor-overlay slot'],
  ['data-slot="editor-shell"', 'editor-shell slot'],
  ['FramePreview', 'FramePreview usage'],
];

for (const [pattern, label] of checks) {
  if (!fileContents.includes(pattern)) {
    console.error(`check-registry: registry output must include ${label}`);
    process.exit(1);
  }
}
