'use client';

import { Editor, useEditor } from '@createcms/react/editor';

import {
  PAGES_DOC,
  pagesComponents,
  pagesSchema,
} from '@/app/demo/_lib/editor';
import { demoRichText } from '@/app/demo/_lib/rich-text';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import { DeviceCanvas } from '@/components/editor-app';
import {
  BlockToolbar,
  DragPreview,
  DropIndicator,
  FieldRing,
  HoverRing,
  InlineText,
  InsertButton,
  Overlay,
  SelectionRing,
} from '@/components/editor-canvas';
import {
  CmsSourcesProvider,
  cmsFields,
} from '@/components/editor-form-createcms';
import { EditorShell } from '@/components/editor-shell';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

function DocumentJson() {
  const version = useEditor((state) => state.version);
  const { getDocument } = useEditor();
  const doc = getDocument();
  void version;

  return (
    <Collapsible
      data-slot="editor-document-json"
      className="border-border shrink-0 border-t"
    >
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center px-4 py-2 text-left text-xs font-medium">
        Document JSON
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="max-h-48 overflow-auto p-4 text-xs leading-relaxed">
          {JSON.stringify(doc, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PagesLiveCanvas() {
  const sources = useDemoFieldSources();
  const { onChange, persistence } = useLocalDocument(PAGES_DOC);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Editor.Root
        richText={demoRichText}
        schema={pagesSchema}
        defaultValue={PAGES_DOC}
        onChange={onChange}
        persistence={persistence}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <EditorShell>
            <DeviceCanvas
              components={pagesComponents}
              style={{ position: 'relative' }}
            >
              <Overlay>
                <SelectionRing />
                <HoverRing />
                <FieldRing />
                <InsertButton placement="between" type="richText" />
                <InlineText />
              </Overlay>
              <Overlay layer="host">
                <BlockToolbar side="top" align="start" />
                <DropIndicator />
                <DragPreview />
              </Overlay>
            </DeviceCanvas>
          </EditorShell>
          <DocumentJson />
        </CmsSourcesProvider>
      </Editor.Root>
    </div>
  );
}
