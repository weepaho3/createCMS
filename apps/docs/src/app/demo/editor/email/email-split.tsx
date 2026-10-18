'use client';

import { Editor } from '@createcms/react/editor';
import { fromEditor } from '@createcms/react/editor/cms';

import { EMAIL_DOC, emailsSchema } from '@/app/demo/_lib/editor';
import { emails } from '@/app/demo/_lib/email-schema';
import { renderEmailHtml } from '@/app/demo/_lib/render-email';
import { demoRichText } from '@/app/demo/_lib/rich-text';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import { EditorEmail } from '@/components/editor-email';
import { CmsSourcesProvider, cmsFields } from '@/components/editor-form';

export function EmailSplitEditor() {
  const sources = useDemoFieldSources();
  const { saved, onChange, persistence } = useLocalDocument(EMAIL_DOC);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Editor.Root
        richText={demoRichText}
        schema={emailsSchema}
        defaultValue={EMAIL_DOC}
        onChange={onChange}
        persistence={persistence}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <EditorEmail
            render={async (doc) => renderEmailHtml(fromEditor(doc, emails))}
          />
        </CmsSourcesProvider>
      </Editor.Root>
      <pre className="border-border max-h-48 overflow-auto border-t p-4 text-xs">
        {JSON.stringify(saved, null, 2)}
      </pre>
    </div>
  );
}
