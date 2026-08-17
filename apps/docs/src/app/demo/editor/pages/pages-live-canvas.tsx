'use client';

import { Editor } from '@createcms/react/editor';
import { useSelection } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';

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
  PaletteItem,
  SelectionRing,
} from '@/components/editor-canvas';
import { CmsSourcesProvider, cmsFields } from '@/components/editor-form';
import { EditorShell } from '@/components/editor-shell';

function DragHandleInner() {
  const selected = useSelection().selected;
  if (!selected) return null;
  return <DragHandle blockId={selected} />;
}

export function PagesLiveCanvas() {
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
                <PaletteItem type="richText" />
                <DragHandleInner />
                <DropIndicator />
                <DragPreview />
                <InlineText />
              </Overlay>
            </Canvas.Root>
          </EditorShell>
        </CmsSourcesProvider>
      </Editor.Root>
      <pre className="border-border max-h-48 overflow-auto border-t p-4 text-xs">
        {JSON.stringify(saved, null, 2)}
      </pre>
    </div>
  );
}
