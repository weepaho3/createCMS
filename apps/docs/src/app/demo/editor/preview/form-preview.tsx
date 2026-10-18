'use client';

import { BlocksRenderer } from '@createcms/core/react/blocks';
import { Editor } from '@createcms/react/editor';
import { fromEditor } from '@createcms/react/editor/cms';
import * as React from 'react';

import { PAGES_DOC, pagesSchema } from '@/app/demo/_lib/editor';
import { messagesDe } from '@/app/demo/_lib/messages-de';
import { pageBlocks } from '@/app/demo/_lib/pages-blocks';
import { pages } from '@/app/demo/_lib/pages-schema';
import { demoRichText } from '@/app/demo/_lib/rich-text';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import { CmsSourcesProvider, cmsFields, Form } from '@/components/editor-form';

export function FormPreviewEditor() {
  const sources = useDemoFieldSources();
  const { saved, latest, onChange, persistence } = useLocalDocument(PAGES_DOC);
  // The catalog is read at mount: a language switch remounts the editor
  // with the latest document.
  const [lang, setLang] = React.useState<'en' | 'de'>('en');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex justify-end px-4 pt-4">
        <button
          type="button"
          className="text-muted-foreground text-xs underline"
          onClick={() => setLang(lang === 'en' ? 'de' : 'en')}
        >
          {lang === 'en' ? 'Deutsch' : 'English'}
        </button>
      </div>
      <Editor.Root
        richText={demoRichText}
        key={lang}
        schema={pagesSchema}
        defaultValue={latest.current}
        messages={lang === 'de' ? messagesDe : undefined}
        onChange={onChange}
        persistence={persistence}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <Editor.LiveAnnouncer />
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 p-4">
            <Form blockId={PAGES_DOC.root.id} />
            <Editor.Preview
              render={(doc) => (
                <BlocksRenderer
                  blocks={pageBlocks}
                  tree={fromEditor(doc, pages)}
                />
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
