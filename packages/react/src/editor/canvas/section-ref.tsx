import * as React from 'react';

import type { AnyEditorSchema } from '../core/schema';
import type { SectionResolver } from '../core/sections';
import type { RenderComponents } from '../render';
import type { CanvasComponent, CanvasComponentProps } from './map';

import { sectionOverridesOf, sectionRefOf } from '../core/sections';
import { renderDocument } from '../render';
import { useSection } from '../sections';
import { CanvasReadonlySubtree } from './readonly';

/**
 * The canvas component for `$ref` blocks: the block is selectable as a
 * whole (`data-kind="ref"`, `data-loading` until resolved), its section
 * renders read-only with `components` and the overrides applied.
 *
 * ```tsx
 * <Canvas.Root components={{ ...blocks, $ref: createSectionRefBlock({ resolver, components: blocks }) }} />
 * ```
 */
export function createSectionRefBlock(options: {
  resolver: SectionResolver;
  components: RenderComponents;
  schema?: AnyEditorSchema;
}): CanvasComponent {
  const { resolver, components, schema } = options;
  function SectionRefBlock({ props, edit }: CanvasComponentProps) {
    const ref = sectionRefOf({ props });
    const section = useSection(resolver, ref, sectionOverridesOf({ props }));
    return (
      <div
        {...edit.block}
        data-kind="ref"
        data-loading={section === null ? '' : undefined}
      >
        <CanvasReadonlySubtree>
          {section
            ? renderDocument(
                {
                  schemaVersion: 0,
                  root: {
                    id: '$section',
                    type: 'root',
                    props: {},
                    slots: { children: [...section.nodes] },
                  },
                },
                components,
                { schema },
              )
            : null}
        </CanvasReadonlySubtree>
      </div>
    );
  }
  return SectionRefBlock;
}
