import type { EditAttrs, EditProps } from '@createcms/schema';
import type { ReactNode } from 'react';

import type { CanvasComponents } from '../map';

import { makeTree, storeSchema } from '../../store/fixtures';

export { makeTree, storeSchema };

export function testEdit(blockId: string, keys: readonly string[]): EditProps {
  const field: Record<string, EditAttrs> = {};
  for (const key of keys) {
    field[key] = { 'data-editor-field': key };
  }
  return {
    active: true,
    block: { 'data-editor-block': blockId },
    field,
  };
}

export function Heading({
  properties,
  edit,
}: {
  properties: { text: string; level: number };
  edit: EditProps;
}) {
  return (
    <section {...edit.block}>
      <h1
        {...edit.field.text}
        style={{
          // Fixed width and height so layout assertions do not
          // depend on font metrics.
          boxSizing: 'border-box',
          width: 200,
          height: 40,
          margin: 0,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {properties.text}
      </h1>
    </section>
  );
}

export function Paragraph({
  properties,
  edit,
}: {
  properties: { text: string };
  edit: EditProps;
}) {
  return (
    <p
      {...edit.block}
      {...edit.field.text}
      style={{
        boxSizing: 'border-box',
        width: 400,
        height: 24,
        margin: 0,
      }}
    >
      {properties.text}
    </p>
  );
}

export function Section({
  edit,
  children,
}: {
  properties: { title?: string };
  edit: EditProps;
  children?: ReactNode;
}) {
  return <section {...edit.block}>{children}</section>;
}

export const canvasBlocks = {
  heading: Heading,
  paragraph: Paragraph,
  section: Section,
} as unknown as CanvasComponents;
