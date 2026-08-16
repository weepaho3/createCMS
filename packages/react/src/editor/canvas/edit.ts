import type { EditAttrs, EditProps } from '@createcms/schema';

import type { AnyEditorSchema } from '../schema';

import { propertiesOf } from '../schema';

export const NO_EDIT: EditProps = Object.freeze({
  active: false,
  block: Object.freeze({}),
  field: Object.freeze({}),
});

export function canvasEdit(
  blockId: string,
  type: string,
  schema: AnyEditorSchema,
  unresolved: boolean,
): EditProps {
  const field: Record<string, EditAttrs> = {};
  for (const key of Object.keys(propertiesOf(schema, type))) {
    field[key] = { 'data-editor-field': key };
  }
  const block = {
    'data-editor-block': blockId,
    ...(unresolved ? { 'data-unresolved': '' } : {}),
  };
  return {
    active: true,
    block: block as EditAttrs,
    field,
  };
}

export type EditCache = {
  get(
    blockId: string,
    type: string,
    schema: AnyEditorSchema,
    unresolved: boolean,
  ): EditProps;
};

export function createEditCache(): EditCache {
  const map = new Map<string, EditProps>();
  return {
    get(blockId, type, schema, unresolved) {
      const key = `${blockId}\0${type}\0${unresolved ? '1' : '0'}`;
      const hit = map.get(key);
      if (hit) return hit;
      const edit = canvasEdit(blockId, type, schema, unresolved);
      map.set(key, edit);
      return edit;
    },
  };
}
