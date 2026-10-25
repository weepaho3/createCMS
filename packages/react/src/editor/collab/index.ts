// @createcms/react/editor/collab: collaborative editing over Yjs. `yjs` and
// `y-protocols` are optional peer dependencies; this is the only subpath
// that imports them.

export type {
  CreateYjsDocStoreOptions,
  YjsDocStore,
  YjsPlacement,
} from './yjs-doc-store';
export { createYjsDocStore, yjsToDocument } from './yjs-doc-store';
