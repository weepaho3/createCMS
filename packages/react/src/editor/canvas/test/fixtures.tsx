import type {
  BlockTreeNode,
  CollectionDefinition,
  EditAttrs,
  EditProps,
} from '@createcms/schema';
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
  properties: { text: string; level: number; badge?: string };
  edit: EditProps;
}) {
  return (
    <section {...edit.block} style={{ position: 'relative' }}>
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
      <span
        {...edit.field.level}
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          boxSizing: 'border-box',
          width: 40,
          height: 20,
        }}
      >
        {properties.level}
      </span>
      {properties.badge ? (
        <span {...edit.field.badge}>{properties.badge}</span>
      ) : null}
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

export const nestedTextSchema = {
  label: 'Pages',
  root: { properties: {} },
  blocks: {
    outer: {
      label: 'Outer',
      allowChildren: true,
      properties: { text: { type: 'string', label: 'Text' } },
    },
    inner: {
      label: 'Inner',
      properties: { text: { type: 'string', label: 'Text' } },
    },
  },
  structure: { outer: { accepts: ['inner'] } },
} satisfies CollectionDefinition;

export function nestedTextTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'outer1',
        type: 'outer',
        properties: { text: 'Outer' },
        children: [
          {
            blockId: 'inner1',
            type: 'inner',
            properties: { text: 'Inner' },
            children: [],
          },
        ],
      },
    ],
  };
}

export function TextNest({
  properties,
  edit,
  children,
}: {
  properties: { text: string };
  edit: EditProps;
  children?: ReactNode;
}) {
  return (
    <section {...edit.block}>
      <p
        {...edit.field.text}
        style={{
          boxSizing: 'border-box',
          width: 200,
          height: 24,
          margin: 0,
        }}
      >
        {properties.text}
      </p>
      {children}
    </section>
  );
}

export const nestedTextBlocks = {
  outer: TextNest,
  inner: TextNest,
} as unknown as CanvasComponents;

export const unionSchema = {
  label: 'Pages',
  root: { properties: {} },
  blocks: {
    pair: {
      label: 'Pair',
      properties: {},
    },
  },
} satisfies CollectionDefinition;

export function unionTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'pair1',
        type: 'pair',
        properties: {},
        children: [],
      },
    ],
  };
}

export function Pair({ edit }: { edit: EditProps }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row' }}>
      <div
        {...edit.block}
        style={{ boxSizing: 'border-box', width: 80, height: 40 }}
      />
      <div
        {...edit.block}
        style={{ boxSizing: 'border-box', width: 80, height: 40 }}
      />
    </div>
  );
}

export const unionBlocks = {
  pair: Pair,
} as unknown as CanvasComponents;

export const insertStackSchema = {
  label: 'Insert',
  root: { properties: {} },
  blocks: {
    stack: {
      label: 'Stack',
      allowChildren: true,
      properties: {},
    },
    cell: {
      label: 'Cell',
      properties: { text: { type: 'string', label: 'Text' } },
    },
    heading: {
      label: 'Heading',
      properties: { text: { type: 'string', label: 'Text' } },
    },
  },
  structure: { stack: { accepts: ['cell'] } },
} satisfies CollectionDefinition;

function InsertCell({
  properties,
  edit,
}: {
  properties: { text: string };
  edit: EditProps;
}) {
  return (
    <div
      {...edit.block}
      {...edit.field.text}
      style={{
        boxSizing: 'border-box',
        width: 80,
        height: 40,
        margin: 0,
        padding: 4,
        overflow: 'hidden',
      }}
    >
      {properties.text}
    </div>
  );
}

function ColumnStack({
  edit,
  children,
}: {
  edit: EditProps;
  children?: ReactNode;
}) {
  return (
    <div
      {...edit.block}
      style={{ display: 'flex', flexDirection: 'column', width: 80 }}
    >
      {children}
    </div>
  );
}

function RowStack({
  edit,
  children,
}: {
  edit: EditProps;
  children?: ReactNode;
}) {
  return (
    <div
      {...edit.block}
      style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap' }}
    >
      {children}
    </div>
  );
}

function GridStack({
  edit,
  children,
}: {
  edit: EditProps;
  children?: ReactNode;
}) {
  return (
    <div
      {...edit.block}
      style={{
        display: 'grid',
        gridTemplateColumns: '80px 80px',
        width: 160,
      }}
    >
      {children}
    </div>
  );
}

function EmptyStack({ edit }: { edit: EditProps }) {
  return (
    <div
      {...edit.block}
      style={{
        boxSizing: 'border-box',
        width: 160,
        height: 80,
      }}
    />
  );
}

function cell(id: string, text: string): BlockTreeNode {
  return {
    blockId: id,
    type: 'cell',
    properties: { text },
    children: [],
  };
}

export function columnStackTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'stack1',
        type: 'stack',
        properties: {},
        children: [cell('c1', '1'), cell('c2', '2'), cell('c3', '3')],
      },
    ],
  };
}

export function rowStackTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'stack1',
        type: 'stack',
        properties: {},
        children: [cell('c1', '1'), cell('c2', '2'), cell('c3', '3')],
      },
    ],
  };
}

export function gridStackTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'stack1',
        type: 'stack',
        properties: {},
        children: [cell('c1', '1'), cell('c2', '2'), cell('c3', '3')],
      },
    ],
  };
}

export function emptyStackTree(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: {},
    children: [
      {
        blockId: 'stack1',
        type: 'stack',
        properties: {},
        children: [],
      },
    ],
  };
}

export const columnStackBlocks = {
  stack: ColumnStack,
  cell: InsertCell,
  heading: InsertCell,
} as unknown as CanvasComponents;

export const rowStackBlocks = {
  stack: RowStack,
  cell: InsertCell,
  heading: InsertCell,
} as unknown as CanvasComponents;

export const gridStackBlocks = {
  stack: GridStack,
  cell: InsertCell,
  heading: InsertCell,
} as unknown as CanvasComponents;

export const emptyStackBlocks = {
  stack: EmptyStack,
  cell: InsertCell,
  heading: InsertCell,
} as unknown as CanvasComponents;
