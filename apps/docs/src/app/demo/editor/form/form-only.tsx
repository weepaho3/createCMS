'use client';

import { Editor } from '@createcms/react/editor';

import { pages } from '@/app/demo/_lib/pages-schema';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import {
  CmsSourcesProvider,
  cmsFields,
  FormSurface,
} from '@/components/editor-form';
import { EditorShell } from '@/components/editor-shell';

export function FormOnlyEditor() {
  const sources = useDemoFieldSources();
  const { saved, onChange, onSave } = useLocalDocument(PAGES_TREE);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Editor.Root
        schema={pages}
        defaultValue={PAGES_TREE}
        onChange={onChange}
        onSave={onSave}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <EditorShell>
            <FormSurface />
          </EditorShell>
        </CmsSourcesProvider>
      </Editor.Root>
      <details className="border-border shrink-0 border-t">
        <summary className="text-muted-foreground cursor-pointer px-4 py-2 text-xs">
          Document JSON
        </summary>
        <pre className="max-h-48 overflow-auto p-4 text-xs">
          {JSON.stringify(saved, null, 2)}
        </pre>
      </details>
    </div>
  );
}
