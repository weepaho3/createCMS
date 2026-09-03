import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicR = path.join(root, 'public/r');

const UI_ITEM_NAMES = [
  'editor-form',
  'editor-canvas',
  'editor-shell',
  'editor-email',
];

const BLOCK_ITEM_NAMES = ['editor-app'];

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

function itemContents(item) {
  return (item.files ?? []).map((file) => file.content ?? '').join('\n');
}

function assertNamedItem(item, name, expectedType) {
  if (item.name !== name) {
    console.error(
      `check-registry: expected name "${name}", got "${item.name}"`,
    );
    process.exit(1);
  }
  if (item.type !== expectedType) {
    console.error(
      `check-registry: expected type "${expectedType}" for ${name}, got "${item.type}"`,
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
}

const catalog = readJson('registry.json');
const catalogNames = new Set((catalog.items ?? []).map((item) => item.name));
const editorFormItem = catalog.items.find(
  (item) => item.name === 'editor-form',
);
const editorFormDeps = editorFormItem?.registryDependencies ?? [];
for (const dep of ['input', 'textarea', 'select', 'checkbox']) {
  if (!editorFormDeps.includes(dep)) {
    console.error(
      `check-registry: editor-form registryDependencies must include "${dep}"`,
    );
    process.exit(1);
  }
}
for (const name of [...UI_ITEM_NAMES, ...BLOCK_ITEM_NAMES]) {
  if (!catalogNames.has(name)) {
    console.error(`check-registry: public/r/registry.json missing "${name}"`);
    process.exit(1);
  }
}

const uiItems = UI_ITEM_NAMES.map((name) =>
  assertNamedItem(readJson(`${name}.json`), name, 'registry:ui'),
);
const blockItems = BLOCK_ITEM_NAMES.map((name) =>
  assertNamedItem(readJson(`${name}.json`), name, 'registry:block'),
);

const uiContents = uiItems.map(itemContents).join('\n');
const blockContents = blockItems.map(itemContents).join('\n');

if (/<(Editor|Canvas)\.Root/.test(uiContents)) {
  console.error(
    'check-registry: ui registry output must not render Editor.Root or Canvas.Root',
  );
  process.exit(1);
}

if (
  !blockContents.includes('<Editor.Root') ||
  !blockContents.includes('<Canvas.Root')
) {
  console.error(
    'check-registry: editor-app must render Editor.Root and Canvas.Root',
  );
  process.exit(1);
}

const uiChecks = [
  ['data-slot="editor-field"', 'editor-field slot'],
  ['cmsFields', 'cmsFields export'],
  ["from '@/components/ui/input'", 'shadcn Input control'],
  ["from '@/components/ui/textarea'", 'shadcn Textarea control'],
  ["from '@/components/ui/select'", 'shadcn Select control'],
  ["from '@/components/ui/checkbox'", 'shadcn Checkbox control'],
  ["'flex flex-col gap-4'", 'Form gap-4'],
  ["'flex flex-col gap-1.5'", 'Field gap-1.5'],
  ['data-slot="editor-form-surface"', 'editor-form-surface slot'],
  ['data-slot="editor-overlay"', 'editor-overlay slot'],
  ['data-slot="editor-shell"', 'editor-shell slot'],
  ['data-slot="editor-toolbar"', 'editor-toolbar slot'],
  ['data-slot="editor-palette"', 'editor-palette slot'],
  ['data-slot="editor-outline"', 'editor-outline slot'],
  ['data-slot="editor-inspector"', 'editor-inspector slot'],
  ['data-slot="editor-surface"', 'editor-surface slot'],
  ['data-slot="editor-selection-chip"', 'editor-selection-chip slot'],
  ['SidebarProvider', 'SidebarProvider usage'],
  ['CommandDialog', 'CommandDialog usage'],
  ['FramePreview', 'FramePreview usage'],
];

const blockChecks = [
  ['function CmsEditor', 'CmsEditor export'],
  ['useCmsDocument', 'useCmsDocument wiring'],
  ['useCmsFieldSources', 'useCmsFieldSources wiring'],
  ['CmsSourcesProvider', 'CmsSourcesProvider'],
  ['fields={cmsFields}', 'cmsFields on Editor.Root'],
  ['key={doc.key}', 'doc.key remount'],
  ['defaultValue={doc.tree}', 'doc.tree defaultValue'],
  ['onSave={doc.save}', 'doc.save'],
  ['onChange={doc.onChange}', 'doc.onChange'],
  ['resolve={doc.resolve}', 'doc.resolve on Canvas.Root'],
  ['EditorShell', 'EditorShell composition'],
  ['mode={mode}', 'EditorShell mode'],
  ['data-slot="editor-app"', 'editor-app slot'],
  ['data-slot="editor-app-loading"', 'loading skeleton slot'],
  ['data-slot="editor-app-error"', 'error state slot'],
  ['data-slot="editor-app-conflict"', 'conflict dialog slot'],
  ['save({ force: true })', 'force save on conflict'],
  ['doc.reload', 'reload retry'],
  ["mode === 'form'", 'form mode'],
  ['SelectionRing', 'SelectionRing overlay'],
  ['HoverRing', 'HoverRing overlay'],
  ['FieldRing', 'FieldRing overlay'],
  ['BlockToolbar', 'BlockToolbar overlay'],
  ['InsertButton', 'InsertButton overlay'],
  ['DragHandle', 'DragHandle overlay'],
  ['DropIndicator', 'DropIndicator overlay'],
  ['DragPreview', 'DragPreview overlay'],
  ['InlineText', 'InlineText overlay'],
  ['AlertDialog', 'AlertDialog conflict UI'],
  ['variant="destructive"', 'destructive overwrite action'],
  ['AlertTitle', 'Alert title'],
  ['role="status"', 'loading status role'],
  ['aria-busy', 'loading aria-busy'],
  ['className="relative"', 'canvas relative class'],
  ['hidden w-64 shrink-0 rounded-none md:block', 'sheet-aware loading columns'],
];

const blockForbidden = [
  ['grid-cols-[16rem_1fr_20rem]', 'desktop-only loading grid'],
  ['onOpenChange={() => {}}', 'empty onOpenChange trap'],
  ['.catch(() => undefined)', 'silent force-save swallow'],
  ["style={{ position: 'relative' }}", 'inline relative position'],
];

for (const [pattern, label] of uiChecks) {
  if (!uiContents.includes(pattern)) {
    console.error(`check-registry: registry output must include ${label}`);
    process.exit(1);
  }
}

for (const [pattern, label] of blockChecks) {
  if (!blockContents.includes(pattern)) {
    console.error(`check-registry: editor-app must include ${label}`);
    process.exit(1);
  }
}

for (const [pattern, label] of blockForbidden) {
  if (blockContents.includes(pattern)) {
    console.error(`check-registry: editor-app must not include ${label}`);
    process.exit(1);
  }
}

const editorAppItem = catalog.items.find((item) => item.name === 'editor-app');
const editorAppDeps = editorAppItem?.registryDependencies ?? [];
for (const dep of ['alert', 'alert-dialog', 'button', 'skeleton']) {
  if (!editorAppDeps.includes(dep)) {
    console.error(
      `check-registry: editor-app registryDependencies must include "${dep}"`,
    );
    process.exit(1);
  }
}
if (editorAppDeps.includes('dialog')) {
  console.error(
    'check-registry: editor-app should depend on alert-dialog, not dialog',
  );
  process.exit(1);
}
