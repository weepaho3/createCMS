import type { EditAttrs, EditProps } from '../core/edit';
import type { AnyEditorSchema } from '../core/schema';

import { componentOf } from '../core/schema';

export { NO_EDIT } from '../core/edit';

/** Block, field and slot anchors for one node of the canvas. */
export function canvasEdit(
  blockId: string,
  type: string,
  schema: AnyEditorSchema,
  unresolved: boolean,
  status: BlockStatus = null,
): EditProps {
  const def = componentOf(schema, type);
  const field: Record<string, EditAttrs> = {};
  for (const key of Object.keys(def?.fields ?? {})) {
    field[key] = { 'data-editor-field': key };
  }
  const block: Record<string, string> = { 'data-editor-block': blockId };
  if (unresolved) block['data-unresolved'] = '';
  if (status === 'loading') block['data-loading'] = '';
  if (status === 'error') block['data-error'] = '';
  const edit: { -readonly [K in keyof EditProps]: EditProps[K] } = {
    active: true,
    block: block as EditAttrs,
    field,
  };
  if (def?.slots) {
    const slot: Record<string, EditAttrs> = {};
    for (const name of Object.keys(def.slots)) {
      slot[name] = { 'data-editor-slot': name };
    }
    edit.slot = slot;
  }
  return edit;
}

/** A block's `resolveData` state as its anchor shows it. */
export type BlockStatus = 'loading' | 'error' | null;

export type EditCache = {
  get(
    blockId: string,
    type: string,
    schema: AnyEditorSchema,
    unresolved: boolean,
    status?: BlockStatus,
  ): EditProps;
};

export function createEditCache(): EditCache {
  const map = new Map<string, EditProps>();
  return {
    get(blockId, type, schema, unresolved, status = null) {
      const key = `${blockId}\0${type}\0${unresolved ? '1' : '0'}\0${status ?? ''}`;
      const hit = map.get(key);
      if (hit) return hit;
      const edit = canvasEdit(blockId, type, schema, unresolved, status);
      map.set(key, edit);
      return edit;
    },
  };
}
