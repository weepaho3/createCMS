'use client';

import { Editor } from '@createcms/react/editor';

import { pages } from '@/app/demo/_lib/pages-schema';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import { CmsSourcesProvider, cmsFields, Form } from '@/components/editor-form';

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
          <Form blockId={PAGES_TREE.blockId} />
        </CmsSourcesProvider>
      </Editor.Root>
      <pre className="border-border max-h-48 overflow-auto border-t p-4 text-xs">
        {JSON.stringify(saved, null, 2)}
      </pre>
    </div>
  );
}
