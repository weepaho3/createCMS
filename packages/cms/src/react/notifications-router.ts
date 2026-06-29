import type {
  NotificationListItem,
  NotificationType,
} from '../core/notifications/types';

/**
 * Concrete `meta` shapes for the built-in core notification types — always
 * typed, no augmentation needed. Mirrors exactly what the core routes emit
 * (comments, merges, approvals, publications).
 */
export interface CoreNotificationMetaMap {
  mention: { messageId: string; threadId: string; rootId: string };
  comment: { messageId: string; threadId: string };
  threadResolved: { threadId: string; rootId: string };
  mergeRequestOpened: {
    mergeRequestId: string;
    rootId: string;
    sourceBranchId: string;
    targetBranchId: string;
  };
  mergeRequestClosed: { mergeRequestId: string; rootId: string };
  mergeRequestReopened: { mergeRequestId: string; rootId: string };
  mergeRequestMerged: {
    mergeRequestId: string;
    rootId: string;
    mergeCommitId?: string;
  };
  approvalRequested: {
    approvalId: string;
    branchId: string;
    commitId: string;
    mergeRequestId?: string;
  };
  approvalApproved: {
    approvalId: string;
    branchId: string;
    mergeRequestId?: string;
  };
  approvalRejected: {
    approvalId: string;
    branchId: string;
    mergeRequestId?: string;
  };
  published: { rootId: string; branchId: string; commitId: string };
}

/**
 * App-extension point for typing notification `meta` per type. Augment via
 * declaration merging to type your own `custom` notifications (or any
 * app-specific types):
 *
 * ```ts
 * declare module '@createcms/core/react' {
 *   interface NotificationMetaMap {
 *     custom: { kind: 'invoice'; invoiceId: string };
 *   }
 * }
 * ```
 *
 * Anything not declared here (and not a core type) falls back to
 * `Record<string, unknown> | null`, so routing stays safe for unknown types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NotificationMetaMap {}

/** The `meta` type for one notification `type`: a core shape, an app-declared
 *  shape, or the open fallback. */
type MetaOf<T extends NotificationType> = T extends keyof CoreNotificationMetaMap
  ? CoreNotificationMetaMap[T]
  : T extends keyof NotificationMetaMap
    ? NotificationMetaMap[T]
    : Record<string, unknown> | null;

/** A notification narrowed to one `type`, with `meta` typed for that type. */
export type TypedNotification<
  T extends NotificationType,
  TActorUser = Record<string, unknown>,
> = Omit<NotificationListItem<TActorUser>, 'type' | 'meta'> & {
  type: T;
  meta: MetaOf<T>;
};

/** What a route resolver returns for one notification. Every field optional, so
 *  a route can contribute only an href, only display data, or both. */
export type NotificationRoute = {
  /** Deep-link target; return `null` to mark the notification non-navigable. */
  href?: string | null;
  label?: string;
  icon?: string;
  group?: string;
};

/**
 * A resolver per notification `type` (each receives the notification with `meta`
 * narrowed to that type) plus a REQUIRED `fallback`. The fallback keeps routing
 * total: `custom` and any future/plugin type always resolve to something.
 */
export type NotificationRoutes<TActorUser = Record<string, unknown>> = {
  [T in NotificationType]?: (
    n: TypedNotification<T, TActorUser>,
  ) => NotificationRoute;
} & {
  fallback: (n: NotificationListItem<TActorUser>) => NotificationRoute;
};

export type NotificationRouter<TActorUser = Record<string, unknown>> = {
  resolve: (n: NotificationListItem<TActorUser>) => NotificationRoute;
};

/**
 * Build a typed deep-link router for notifications. Define a resolver per
 * notification `type` (each gets `meta` narrowed to that type's shape) plus a
 * required `fallback`. Pure and client-side — it folds over the existing
 * notification fields (`type`, `resourceId`, `collection`, `meta`), so it needs
 * no server or schema change.
 *
 * ```ts
 * const router = createNotificationRouter({
 *   mention: (n) => ({ href: `/threads/${n.meta.threadId}#${n.meta.messageId}` }),
 *   published: (n) => ({ href: `/${n.collection}/${n.resourceId}` }),
 *   fallback: (n) => ({ href: n.resourceId ? `/${n.collection}/${n.resourceId}` : null }),
 * });
 *
 * const route = router.resolve(notification); // { href, icon, ... }
 * ```
 *
 * See {@link NotificationMetaMap} to type `custom`/app-specific `meta`.
 */
export function createNotificationRouter<TActorUser = Record<string, unknown>>(
  routes: NotificationRoutes<TActorUser>,
): NotificationRouter<TActorUser> {
  return {
    resolve(n) {
      const handler = routes[n.type] as
        | ((item: NotificationListItem<TActorUser>) => NotificationRoute)
        | undefined;
      return (handler ?? routes.fallback)(n);
    },
  };
}
