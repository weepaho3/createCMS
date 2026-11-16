// @registry ui-sdk-editor@0.3.2
'use client';

// The fields of the selected block and of the page, in two tabs. Plugins add
// UI through the `inspector-header` and `inspector-footer` outlets.

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

import { IconButton, blockIcon } from './chrome';
import { Form } from './form';

export function Inspector() {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const block = useAnyBlock(selected);
  const actions = useBlockActions(selected ?? '');
  const palette = usePalette();
  const label =
    palette.find((item) => item.type === block?.type)?.label ?? block?.type;
  const Icon = blockIcon(block?.type ?? '');

  return (
    <div data-slot="editor-inspector" className="ed-inspector">
      <Tabs defaultValue="block" className="ed-tabs">
        <header className="ed-inspector-head">
          {selected && block ? (
            <div className="ed-row">
              <Icon aria-hidden />
              <span className="ed-inspector-title">{label}</span>
              <Editor.Slot
                name="inspector-header"
                props={{ blockId: selected }}
              />
              {actions.parent !== null ? (
                <>
                  <IconButton
                    label="Duplicate"
                    onClick={() => actions.duplicate()}
                  >
                    <CopyIcon />
                  </IconButton>
                  <IconButton label="Delete" onClick={() => actions.remove()}>
                    <Trash2Icon />
                  </IconButton>
                </>
              ) : null}
            </div>
          ) : (
            <div className="ed-row ed-muted">Inspector</div>
          )}
          <TabsList aria-label="Inspector" className="ed-tab-list">
            <TabsTab value="block" className="ed-tab">
              Block
            </TabsTab>
            <TabsTab value="page" className="ed-tab">
              Page
            </TabsTab>
          </TabsList>
        </header>
        <TabsPanel value="block" className="ed-tab-panel">
          {selected ? (
            <Form blockId={selected} autoScroll />
          ) : (
            <div className="ed-empty-state">
              <BoxIcon aria-hidden />
              <p>Select a block to edit its fields.</p>
            </div>
          )}
        </TabsPanel>
        <TabsPanel value="page" className="ed-tab-panel">
          <Form blockId={rootId} />
        </TabsPanel>
      </Tabs>
      <footer className="ed-inspector-foot">
        <Editor.Slot
          name="inspector-footer"
          props={{ blockId: selected ?? rootId }}
        />
      </footer>
    </div>
  );
}
