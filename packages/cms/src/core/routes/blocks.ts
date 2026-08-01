import type { CMSProcedureContext, CollectionWithName } from '../types';

import { createBlockEndpoints } from './blocks-block-endpoints';
import { buildBlocksContext } from './blocks-context';
import { createRootEndpoints } from './blocks-root-endpoints';

// ============================================================================
// Block routes factory
// ============================================================================

export function createBlocksEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureContext,
) {
  const ctx = buildBlocksContext(def, cmsCtx);
  return {
    ...createRootEndpoints(ctx),
    ...createBlockEndpoints(ctx),
  };
}
