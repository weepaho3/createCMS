// @registry ui-sdk-editor-inspector@0.3.2
'use client';

// The selected block's fields and the page fields, in UI SDK Tabs. Plugins
// add UI through the `inspector-header` and `inspector-footer` outlets.

import {
  Editor,
  useAnyBlock,
  useBlockActions,
  useEditor,
  usePalette,
  useSelection,
} from '@createcms/react/editor';
import { Tabs, TabsList, TabsPanel, TabsTab } from '@ui-sdk/react/tabs';
import { BoxIcon, CopyIcon, Trash2Icon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import { blockTypeIcon, ToolbarHintButton } from './editor-chrome';
import { Form } from './editor-form';

const TAB =
  'text-muted-foreground hover:text-foreground data-selected:text-foreground data-selected:after:bg-foreground relative -mb-px py-2 text-sm font-medium outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 focus-visible:ring-2 focus-visible:ring-ring';

function EditorInspector({ className, ...props }: React.ComponentProps<'div'>) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const block = useAnyBlock(selected);
  const palette = usePalette();
  const actions = useBlockActions(selected ?? '');
  const label =
    palette.find((item) => item.type === block?.type)?.label ??
    block?.type ??
    null;
  const Icon = blockTypeIcon(block?.type ?? '');

  return (
    <div
      data-slot="editor-inspector"
      className={cn('flex min-h-0 flex-1 flex-col', className)}
      {...props}
    >
      <Tabs defaultValue="block" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="bg-background sticky top-0 z-10 border-b">
          <div className="flex items-center gap-2 px-3 py-2">
            {selected && block ? (
              <>
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {label}
                </span>
                <Editor.Slot
                  name="inspector-header"
                  props={{ blockId: selected }}
                />
                {actions.parent !== null ? (
                  <div className="flex items-center gap-1">
                    <ToolbarHintButton
                      label="Duplicate"
                      onClick={() => actions.duplicate()}
                    >
                      <CopyIcon />
                    </ToolbarHintButton>
                    <ToolbarHintButton
                      label="Delete"
                      onClick={() => actions.remove()}
                    >
                      <Trash2Icon />
                    </ToolbarHintButton>
                  </div>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground text-sm">Inspector</span>
            )}
          </div>
          <TabsList
            aria-label="Inspector"
            className="flex w-full justify-start gap-4 px-3"
          >
            <TabsTab value="block" className={TAB}>
              Block
            </TabsTab>
            <TabsTab value="page" className={TAB}>
              Page
            </TabsTab>
          </TabsList>
        </div>
        <TabsPanel
          value="block"
          className="min-h-0 flex-1 overflow-y-auto p-3 outline-none"
        >
          {selected ? (
            <Form blockId={selected} autoScroll />
          ) : (
            <div className="text-muted-foreground flex flex-col items-center gap-2 px-4 py-10 text-center text-sm">
              <BoxIcon className="size-8 opacity-40" />
              <p>Select a block to edit its fields.</p>
            </div>
          )}
        </TabsPanel>
        <TabsPanel
          value="page"
          className="min-h-0 flex-1 overflow-y-auto p-3 outline-none"
        >
          <Form blockId={rootId} />
        </TabsPanel>
      </Tabs>
      <div
        data-slot="editor-inspector-footer"
        className="border-t p-3 empty:hidden"
      >
        <Editor.Slot
          name="inspector-footer"
          props={{ blockId: selected ?? rootId }}
        />
      </div>
    </div>
  );
}

export { EditorInspector };
