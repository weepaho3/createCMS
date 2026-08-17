'use client';

import { BlocksRenderer } from '@createcms/core/react/blocks';
import { Editor } from '@createcms/react/editor';

import { pageBlocks } from '@/app/demo/_lib/pages-blocks';
import { pages } from '@/app/demo/_lib/pages-schema';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import { CmsSourcesProvider, cmsFields, Form } from '@/components/editor-form';

export function FormPreviewEditor() {
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
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-4">
            <Form blockId={PAGES_TREE.blockId} />
            <Editor.Preview
              render={(tree) => (
                <BlocksRenderer blocks={pageBlocks} tree={tree} />
              )}
            />
          </div>
        </CmsSourcesProvider>
      </Editor.Root>
      <pre className="border-border max-h-48 overflow-auto border-t p-4 text-xs">
        {JSON.stringify(saved, null, 2)}
      </pre>
    </div>
  );
}
