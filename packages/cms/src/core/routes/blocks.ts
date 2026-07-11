import type { CMSProcedureContext, CollectionWithName } from '../types';

import { buildBlocksContext } from './blocks-context';
import { createBlockEndpoints } from './blocks-block-endpoints';
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
