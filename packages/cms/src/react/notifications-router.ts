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
 * App-extension point for typing notification `meta` per type, for `custom` (or
 * other app-specific) notifications raised WITHOUT a plugin. Augment via
 * declaration merging:
 *
 * ```ts
 * declare module '@createcms/core/react' {
 *   interface NotificationMetaMap {
 *     custom: { kind: 'invoice'; invoiceId: string };
 *   }
 * }
 * ```
 *
 * Plugin-contributed types come through `typeof cms` instead (a plugin's
 * `notificationTypes` map) — pass `createNotificationRouter<typeof cms>(…)` to
 * pick them up. Anything not in a core type, the CMS, or this map falls back to
 * `Record<string, unknown> | null`, so routing stays safe for unknown types.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface NotificationMetaMap {}

/** The type-only notification registry a configured `typeof cms` carries —
 *  plugin `meta` shapes + the actor-user shape. Matched structurally so the
 *  router needs no value import of the CMS. */
type CmsNotificationMarker = {
  $notifications: { meta: Record<string, unknown>; actorUser: unknown };
};

/** Default when `createNotificationRouter` is called without a `typeof cms` —
 *  core types + app-augmented `NotificationMetaMap` only, loose actor. */
type DefaultMarker = {
  $notifications: { meta: Record<never, never>; actorUser: Record<string, unknown> };
};

type PluginMetaOf<TCms> = TCms extends {
  $notifications: { meta: infer M };
}
  ? M
  : Record<never, never>;

type ActorOf<TCms> = TCms extends {
  $notifications: { actorUser: infer A };
}
  ? A
  : Record<string, unknown>;

/** Every notification `type` the router knows: core + plugin (from `typeof cms`)
 *  + app (`NotificationMetaMap`). */
type KnownNotificationType<TCms> =
  | NotificationType
  | Extract<keyof PluginMetaOf<TCms>, string>
  | Extract<keyof NotificationMetaMap, string>;

/** The `meta` type for one notification `type`: core, then plugin, then app,
 *  then the open fallback. */
type MetaOf<TCms, T extends string> = T extends keyof CoreNotificationMetaMap
  ? CoreNotificationMetaMap[T]
  : T extends keyof PluginMetaOf<TCms>
    ? PluginMetaOf<TCms>[T]
    : T extends keyof NotificationMetaMap
      ? NotificationMetaMap[T]
      : Record<string, unknown> | null;

/** A notification narrowed to one `type`, with `meta` (and `actorUser`) typed
 *  for that type + CMS. */
export type TypedNotification<
  T extends string,
  TCms = DefaultMarker,
> = Omit<NotificationListItem<ActorOf<TCms>>, 'type' | 'meta'> & {
  type: T;
  meta: MetaOf<TCms, T>;
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
 * total: `custom` and any future/plugin type without an explicit resolver always
 * resolve to something.
 */
export type NotificationRoutes<TCms = DefaultMarker> = {
  [T in KnownNotificationType<TCms>]?: (
    n: TypedNotification<T, TCms>,
  ) => NotificationRoute;
} & {
  fallback: (n: NotificationListItem<ActorOf<TCms>>) => NotificationRoute;
};

export type NotificationRouter<TCms = DefaultMarker> = {
  resolve: (n: NotificationListItem<ActorOf<TCms>>) => NotificationRoute;
};

/**
 * Build a typed deep-link router for notifications. Define a resolver per
 * notification `type` (each gets `meta` narrowed to that type's shape) plus a
 * required `fallback`. Pure and client-side — it folds over the existing
 * notification fields (`type`, `resourceId`, `collection`, `meta`), so it needs
 * no server or schema change.
 *
 * Pass your CMS type to pick up plugin-contributed notification types with full
 * `meta` typing (and your `actorUser` shape):
 *
 * ```ts
 * const router = createNotificationRouter<typeof cms>({
 *   mention: (n) => ({ href: `/threads/${n.meta.threadId}#${n.meta.messageId}` }),
 *   abTestWinner: (n) => ({ href: `/experiments/${n.meta.testId}` }), // from a plugin
 *   published: (n) => ({ href: `/${n.collection}/${n.resourceId}` }),
 *   fallback: (n) => ({ href: n.resourceId ? `/${n.collection}/${n.resourceId}` : null }),
 * });
 *
 * const route = router.resolve(notification); // { href, icon, ... }
 * ```
 *
 * Without a `typeof cms`, core types are typed and `NotificationMetaMap` covers
 * your `custom`/app types. See {@link NotificationMetaMap}.
 */
export function createNotificationRouter<TCms extends CmsNotificationMarker = DefaultMarker>(
  routes: NotificationRoutes<TCms>,
): NotificationRouter<TCms> {
  return {
    resolve(n) {
      const handler = (routes as Record<string, unknown>)[n.type] as
        | ((item: NotificationListItem<ActorOf<TCms>>) => NotificationRoute)
        | undefined;
      return (handler ?? routes.fallback)(n);
    },
  };
}
