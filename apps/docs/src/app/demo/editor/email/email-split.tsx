'use client';

import { Editor } from '@createcms/react/editor';

import { emails } from '@/app/demo/_lib/email-schema';
import { EMAIL_TREE } from '@/app/demo/_lib/email-tree';
import { renderEmailHtml } from '@/app/demo/_lib/render-email';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import { EditorEmail } from '@/components/editor-email';
import { CmsSourcesProvider, cmsFields } from '@/components/editor-form';

export function EmailSplitEditor() {
  const sources = useDemoFieldSources();
  const { saved, onChange, onSave } = useLocalDocument(EMAIL_TREE);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Editor.Root
        schema={emails}
        defaultValue={EMAIL_TREE}
        onChange={onChange}
        onSave={onSave}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <EditorEmail render={async (tree) => renderEmailHtml(tree)} />
        </CmsSourcesProvider>
      </Editor.Root>
      <pre className="border-border max-h-48 overflow-auto border-t p-4 text-xs">
        {JSON.stringify(saved, null, 2)}
      </pre>
    </div>
  );
}
