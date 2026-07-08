'use client';

// This convenience barrel re-exports the client APIs (createCMSClient/useStore +
// the query/notification-router helpers), so it is a CLIENT boundary — importing
// it from a Server Component is an error. RSC code uses the granular, server-safe
// entries instead: `@createcms/core/react/blocks` (rendering) and
// `@createcms/core/react/variant` (pickVariant). (react-02)
export { createCMSClient } from '../client/react';
export { useStore } from '../client/react-store';
export { createCMSQuery } from '../client/query';
export { CMSClientError } from '../client/error';
export {
  createBlocksMap,
  extractBlockEvents,
  BlocksRenderer,
  createBlocksRenderer,
  createContentRenderer,
} from './blocks';
export type { BlocksMap, BlockComponentProps, BlockProps } from './blocks';
export type { EventDeclaration } from '../core/types/definitions';
export { pickVariant } from './variant';
export type {
  CMSClientInstance,
  CMSClientOptions,
  CMSClientPlugin,
  CMSClientStore,
  CMSAtomListener,
  CMSFetch,
  QueryState,
} from '../client/types';
export { createNotificationRouter } from './notifications-router';
export type {
  NotificationRoute,
  NotificationRoutes,
  NotificationRouter,
  TypedNotification,
  CoreNotificationMetaMap,
  NotificationMetaMap,
} from './notifications-router';
