'use client';

import { Editor, useEditor, useSelection } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import * as React from 'react';

import { pageBlocks } from '@/app/demo/_lib/pages-blocks';
import { pages } from '@/app/demo/_lib/pages-schema';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';
import { useDemoFieldSources } from '@/app/demo/_lib/sources';
import { useLocalDocument } from '@/app/demo/_lib/use-local-document';
import {
  BlockToolbar,
  DragHandle,
  DragPreview,
  DropIndicator,
  FieldRing,
  HoverRing,
  InlineText,
  InsertButton,
  Overlay,
  SelectionRing,
} from '@/components/editor-canvas';
import { CmsSourcesProvider, cmsFields } from '@/components/editor-form';
import { EditorShell } from '@/components/editor-shell';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

function DragHandleInner() {
  const selected = useSelection().selected;
  if (!selected) return null;
  return <DragHandle blockId={selected} />;
}

function DocumentJson() {
  const version = useEditor((state) => state.version);
  const { getTree } = useEditor();
  const tree = getTree();
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
          {JSON.stringify(tree, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PagesLiveCanvas() {
  const sources = useDemoFieldSources();
  const { onChange, onSave } = useLocalDocument(PAGES_TREE);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Editor.Root
        schema={pages}
        defaultValue={PAGES_TREE}
        onChange={onChange}
        onSave={onSave}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <EditorShell>
            <Canvas.Root
              components={pageBlocks}
              style={{ position: 'relative' }}
            >
              <Overlay>
                <SelectionRing />
                <HoverRing />
                <FieldRing />
                <BlockToolbar side="top" align="start" />
                <InsertButton placement="between" type="richText" />
                <DragHandleInner />
                <DropIndicator />
                <DragPreview />
                <InlineText />
              </Overlay>
            </Canvas.Root>
          </EditorShell>
          <DocumentJson />
        </CmsSourcesProvider>
      </Editor.Root>
    </div>
  );
}
