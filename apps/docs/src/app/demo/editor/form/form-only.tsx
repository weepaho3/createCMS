'use client';

import { useEditor } from '@createcms/react/editor';
import * as React from 'react';

import { createDemoCmsClient } from '@/app/demo/_lib/demo-cms-client';
import { pageBlocks } from '@/app/demo/_lib/pages-blocks';
import { pages } from '@/app/demo/_lib/pages-schema';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';
import { CmsEditor } from '@/components/editor-app';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

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
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground mt-8 flex w-full cursor-pointer items-center rounded-md border px-3 py-2 text-left text-xs font-medium">
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

export function FormOnlyEditor() {
  const client = React.useMemo(() => createDemoCmsClient(), []);

  return (
    <CmsEditor
      client={client}
      collection="pages"
      rootId={PAGES_TREE.blockId}
      branchId="demo"
      schema={pages}
      components={pageBlocks}
      mode="form"
    >
      <DocumentJson />
    </CmsEditor>
  );
}
