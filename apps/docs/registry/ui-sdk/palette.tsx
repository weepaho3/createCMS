// @registry ui-sdk-editor@0.3.2
'use client';

// The block types to drag onto the canvas, by category. A press inserts
// the type like the add dialog does.

import { Editor, usePalette } from '@createcms/react/editor';
import { groupPaletteItems } from '@createcms/react/editor/core';
import { GripVerticalIcon, PlusIcon } from 'lucide-react';

import { PaletteItem } from './canvas';
import { IconButton, blockIcon, useChrome } from './chrome';

export function BlockPalette() {
  const groups = groupPaletteItems(usePalette());
  const { openPalette } = useChrome();
  return (
    <section
      data-slot="editor-palette"
      aria-labelledby="ed-palette-title"
      className="ed-panel-section"
    >
      <header className="ed-panel-heading">
        <h2 id="ed-palette-title">Palette</h2>
        <IconButton
          label="Add block"
          size="xs"
          onClick={() => openPalette('add')}
        >
          <PlusIcon />
        </IconButton>
      </header>
      {groups.map((group) => (
        <div key={group.category ?? ''} className="ed-palette-group">
          {group.category ? <h3>{group.category}</h3> : null}
          <ul>
            {group.items.map((item) => {
              const Icon = blockIcon(item.type);
              return (
                <li key={item.type}>
                  <PaletteItem type={item.type} className="ed-palette-item">
                    {item.previewImageUrl ? (
                      <img
                        src={item.previewImageUrl}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="ed-preview"
                        data-large=""
                      />
                    ) : null}
                    <GripVerticalIcon aria-hidden className="ed-muted" />
                    <Icon aria-hidden />
                    {item.label}
                  </PaletteItem>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <Editor.Slot name="palette-footer" />
    </section>
  );
}
