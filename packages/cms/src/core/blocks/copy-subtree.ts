import { newId } from '../../utils/nanoid';

export type BlockVersionRow = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  children: string[];
  deleted: boolean;
};

type CopyDescriptor = {
  oldBlockId: string;
  newBlockId: string;
  type: string;
  properties: Record<string, unknown>;
  newChildren: string[];
};

export function deepCopySubtree(
  versionByBlockId: Map<string, BlockVersionRow>,
  startBlockId: string,
): { copies: CopyDescriptor[]; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();

  const collectIds = (blockId: string) => {
    idMap.set(blockId, newId('block'));
    const version = versionByBlockId.get(blockId);
    if (!version) return;

    for (const childId of version.children ?? []) {
      collectIds(childId);
    }
  };

  collectIds(startBlockId);

  const copies: CopyDescriptor[] = [];

  const buildCopies = (blockId: string) => {
    const version = versionByBlockId.get(blockId);
    if (!version) return;

    const newBlockId = idMap.get(blockId)!;
    const newChildren = (version.children ?? []).map((id) => idMap.get(id)!);

    copies.push({
      oldBlockId: blockId,
      newBlockId,
      type: version.type,
      properties: version.properties,
      newChildren,
    });

    for (const childId of version.children ?? []) {
      buildCopies(childId);
    }
  };

  buildCopies(startBlockId);

  return { copies, idMap };
}
