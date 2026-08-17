import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicR = path.join(root, 'public/r');

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

const registry = readJson('registry.json');
const editorForm = readJson('editor-form.json');

if (editorForm.name !== 'editor-form') {
  console.error(
    `check-registry: expected name "editor-form", got "${editorForm.name}"`,
  );
  process.exit(1);
}

if (editorForm.type !== 'registry:ui') {
  console.error(
    `check-registry: expected type "registry:ui", got "${editorForm.type}"`,
  );
  process.exit(1);
}

if (!Array.isArray(editorForm.dependencies)) {
  console.error('check-registry: editor-form.json missing dependencies array');
  process.exit(1);
}

if (!editorForm.dependencies.includes('@createcms/react')) {
  console.error('check-registry: dependencies must include @createcms/react');
  process.exit(1);
}

const fileContents = [editorForm, ...(registry.items ?? [])]
  .flatMap((item) => item.files ?? [])
  .map((file) => file.content ?? '')
  .join('\n');

if (/Editor\.Root/.test(fileContents)) {
  console.error(
    'check-registry: registry output must not reference Editor.Root',
  );
  process.exit(1);
}

if (!/data-slot="editor-field"/.test(fileContents)) {
  console.error(
    'check-registry: registry output must include data-slot="editor-field"',
  );
  process.exit(1);
}
