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
  comment: { messageId: string; threadId: string; rootId: string };
  threadResolved: { threadId: string; rootId: string };
  threadReopened: { threadId: string; rootId: string };
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
    rootId: string;
    branchId: string;
    branchName: string;
    commitId: string;
    mergeRequestId?: string;
  };
  approvalApproved: {
    approvalId: string;
    rootId: string;
    branchId: string;
    branchName: string;
    mergeRequestId?: string;
  };
  approvalRejected: {
    approvalId: string;
    rootId: string;
    branchId: string;
    branchName: string;
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
  $InferNotifications: { meta: Record<string, unknown>; actorUser: unknown };
};

/** Default when `createNotificationRouter` is called without a `typeof cms` —
 *  core types + app-augmented `NotificationMetaMap` only, loose actor. */
type DefaultMarker = {
  $InferNotifications: { meta: Record<never, never>; actorUser: Record<string, unknown> };
};

/**
 * Strip any `string`/`number`/`symbol` index signature from `T`. Without this, a
 * CMS that contributes NO plugin notification types resolves its registry to
 * `Record<string, never>` (or `never`), whose `keyof` is `string` — that widens
 * {@link KnownNotificationType} to `string` and collapses every `meta` to
 * `never`. Stripping the index signature collapses such a registry to `{}`
 * (`keyof {}` is `never`), while keeping any concrete plugin keys intact.
 */
type RemoveIndex<T> = {
  [K in keyof T as string extends K
    ? never
    : number extends K
      ? never
      : symbol extends K
        ? never
        : K]: T[K];
};

type PluginMetaOf<TCMS> = TCMS extends {
  $InferNotifications: { meta: infer M };
}
  ? RemoveIndex<M>
  : Record<never, never>;

type ActorOf<TCMS> = TCMS extends {
  $InferNotifications: { actorUser: infer A };
}
  ? A
  : Record<string, unknown>;

/** Every notification `type` the router knows: core + plugin (from `typeof cms`)
 *  + app (`NotificationMetaMap`). */
type KnownNotificationType<TCMS> =
  | NotificationType
  | Extract<keyof PluginMetaOf<TCMS>, string>
  | Extract<keyof NotificationMetaMap, string>;

/** The `meta` type for one notification `type`: core, then plugin, then app,
 *  then the open fallback. */
type MetaOf<TCMS, T extends string> = T extends keyof CoreNotificationMetaMap
  ? CoreNotificationMetaMap[T]
  : T extends keyof PluginMetaOf<TCMS>
    ? PluginMetaOf<TCMS>[T]
    : T extends keyof NotificationMetaMap
      ? NotificationMetaMap[T]
      : Record<string, unknown> | null;

/** A notification narrowed to one `type`, with `meta` (and `actorUser`) typed
 *  for that type + CMS. */
export type TypedNotification<
  T extends string,
  TCMS = DefaultMarker,
> = Omit<NotificationListItem<ActorOf<TCMS>>, 'type' | 'meta'> & {
  type: T;
  meta: MetaOf<TCMS, T>;
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
export type NotificationRoutes<TCMS = DefaultMarker> = {
  [T in KnownNotificationType<TCMS>]?: (
    n: TypedNotification<T, TCMS>,
  ) => NotificationRoute;
} & {
  fallback: (n: NotificationListItem<ActorOf<TCMS>>) => NotificationRoute;
};

export type NotificationRouter<TCMS = DefaultMarker> = {
  resolve: (n: NotificationListItem<ActorOf<TCMS>>) => NotificationRoute;
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
export function createNotificationRouter<TCMS extends CmsNotificationMarker = DefaultMarker>(
  routes: NotificationRoutes<TCMS>,
): NotificationRouter<TCMS> {
  return {
    resolve(n) {
      const handler = (routes as Record<string, unknown>)[n.type] as
        | ((item: NotificationListItem<ActorOf<TCMS>>) => NotificationRoute)
        | undefined;
      return (handler ?? routes.fallback)(n);
    },
  };
}
