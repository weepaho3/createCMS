import type { ReactNode } from 'react';

import type { EditorDocument, NodeData } from '../../core/document';
import type { EditAttrs, EditProps } from '../../core/edit';
import type { CanvasComponents } from '../map';

import { defineEditorSchema } from '../../core/schema';
import { makeDoc, storeSchema } from '../../core/store/fixtures';

export { makeDoc, storeSchema };

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
  props: properties,
  edit,
}: {
  props: { text: string; level: number; badge?: string };
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
  props: properties,
  edit,
}: {
  props: { text: string };
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
  props: { title?: string };
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

export const nestedTextSchema = defineEditorSchema({
  root: { label: 'Pages', fields: {}, slots: { children: {} } },
  components: {
    outer: {
      label: 'Outer',
      fields: { text: { type: 'text', label: 'Text' } },
      slots: { children: { allow: ['inner'] } },
    },
    inner: {
      label: 'Inner',
      fields: { text: { type: 'text', label: 'Text' } },
    },
  },
});

export function nestedTextTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'outer1',
            type: 'outer',
            props: { text: 'Outer' },
            slots: {
              children: [
                {
                  id: 'inner1',
                  type: 'inner',
                  props: { text: 'Inner' },
                },
              ],
            },
          },
        ],
      },
    },
  };
}

export function TextNest({
  props: properties,
  edit,
  children,
}: {
  props: { text: string };
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

export const unionSchema = defineEditorSchema({
  root: { label: 'Pages', fields: {}, slots: { children: {} } },
  components: { pair: { label: 'Pair', fields: {} } },
});

export function unionTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'pair1',
            type: 'pair',
            props: {},
          },
        ],
      },
    },
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

export const insertStackSchema = defineEditorSchema({
  root: { label: 'Insert', fields: {}, slots: { children: {} } },
  components: {
    stack: {
      label: 'Stack',
      fields: {},
      slots: { children: { allow: ['cell'] } },
    },
    cell: { label: 'Cell', fields: { text: { type: 'text', label: 'Text' } } },
    heading: {
      label: 'Heading',
      fields: { text: { type: 'text', label: 'Text' } },
    },
  },
});

export const nestedOnlyStackSchema = defineEditorSchema({
  ...insertStackSchema,
  root: {
    ...insertStackSchema.root,
    slots: { children: { disallow: ['cell'] } },
  },
});

function InsertCell({
  props: properties,
  edit,
}: {
  props: { text: string };
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

function cell(id: string, text: string): NodeData {
  return {
    id: id,
    type: 'cell',
    props: { text },
  };
}

export function columnStackTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'stack1',
            type: 'stack',
            props: {},
            slots: {
              children: [cell('c1', '1'), cell('c2', '2'), cell('c3', '3')],
            },
          },
        ],
      },
    },
  };
}

export function rowStackTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'stack1',
            type: 'stack',
            props: {},
            slots: {
              children: [cell('c1', '1'), cell('c2', '2'), cell('c3', '3')],
            },
          },
        ],
      },
    },
  };
}

export function gridStackTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'stack1',
            type: 'stack',
            props: {},
            slots: {
              children: [cell('c1', '1'), cell('c2', '2'), cell('c3', '3')],
            },
          },
        ],
      },
    },
  };
}

export function emptyStackTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'stack1',
            type: 'stack',
            props: {},
          },
        ],
      },
    },
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

export const twoSlotSchema = defineEditorSchema({
  root: { label: 'Slots', fields: {}, slots: { children: {} } },
  components: {
    columns: {
      label: 'Columns',
      fields: {},
      slots: { left: { allow: ['cell'] }, right: { allow: ['cell'] } },
    },
    cell: { label: 'Cell', fields: { text: { type: 'text', label: 'Text' } } },
  },
});

function TwoColumns({
  edit,
  slots,
}: {
  edit: EditProps;
  slots: Readonly<Record<string, ReactNode>>;
}) {
  const column = { boxSizing: 'border-box', width: 160, height: 120 } as const;
  return (
    <div {...edit.block} style={{ display: 'flex', width: 320 }}>
      <div {...edit.slot?.left} style={column}>
        {slots.left}
      </div>
      <div {...edit.slot?.right} style={column}>
        {slots.right}
      </div>
    </div>
  );
}

export function twoSlotTree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: {},
      slots: {
        children: [
          {
            id: 'cols',
            type: 'columns',
            props: {},
            slots: { left: [cell('c1', 'Left')], right: [] },
          },
        ],
      },
    },
  };
}

export const twoSlotBlocks = {
  columns: TwoColumns,
  cell: InsertCell,
} as unknown as CanvasComponents;
