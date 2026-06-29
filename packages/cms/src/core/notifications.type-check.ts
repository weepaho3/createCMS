// Type-only assertions for the notifications config gate. Checked by
// `check-types` (tsc --noEmit over src), not executed. If the gating breaks,
// the `@ts-expect-error` below becomes unused and tsc fails — so this file is
// self-verifying.

import { pgTable, text } from 'drizzle-orm/pg-core';
import * as z from 'zod';

import { createCMSClient } from '../client/vanilla';
import { createNotificationRouter } from '../react/notifications-router';
import { useNotifications } from '../react/realtime';
import { defineCollections } from './define';
import { createCMS } from './factory';
import type { DrizzleInstance } from './types/drizzle';
import type { CMSPlugin } from './types/plugin';
import type { MediaConfig } from './types/s3';

declare const db: DrizzleInstance;
declare const media: MediaConfig;
const collections = defineCollections({});

// --- notifications ENABLED (default) -------------------------------------
const enabled = createCMS({ db, media, collections });
// The inbox namespace and the `notify` helper exist.
void enabled.api.notifications.listNotifications;
void enabled.notify;

// --- notifications EXPLICITLY enabled ------------------------------------
const explicit = createCMS({ db, media, collections, notifications: true });
void explicit.api.notifications.listNotifications;
void explicit.notify;

// --- a WIDENED boolean keeps the types ENABLED (documented contract) ------
declare const flag: boolean;
const widened = createCMS({ db, media, collections, notifications: flag });
void widened.api.notifications.listNotifications;
void widened.notify;

// --- notifications DISABLED ----------------------------------------------
const disabled = createCMS({ db, media, collections, notifications: false });
// `notify` AND `notificationService` are typed `undefined` (gated in parallel).
disabled.notify satisfies undefined;
disabled.notificationService satisfies undefined;
// …and present when enabled:
enabled.notificationService satisfies object;
// The `notifications` namespace is ABSENT from `cms.api` — accessing it is a
// compile error, so `client.notifications` is absent for free.
// @ts-expect-error - notifications namespace gated out when notifications: false
void disabled.api.notifications;

// --- useNotifications accepts the REAL typed client with NO cast -----------
// Regression guard: the NotificationsClient shim must match the client's
// `WithUserQuery` (not plain boolean), so `useNotifications(client, …)` compiles
// directly — no `as unknown as Parameters<typeof useNotifications>[0]`.
const realtimeClient = createCMSClient<typeof enabled>()({ baseURL: '/api/cms' });
export const _useNotificationsAcceptsRealClient = () =>
  useNotifications(realtimeClient, { userId: 'u1', withUser: true });

// --- actorUser is TYPED off the CMS `user` config (not `unknown`) ----------
const userTable = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email'),
});
const withUserCms = createCMS({
  db,
  media,
  collections,
  user: { table: userTable, idColumn: userTable.id, exposeColumns: ['name', 'email'] },
});

type ListResult = Awaited<
  ReturnType<typeof withUserCms.api.notifications.listNotifications>
>;
type Actor = NonNullable<ListResult['notifications'][number]['actorUser']>;
// A real user column is typed (would error if `actorUser` were `unknown`):
export const _actorName: string | null | undefined = (null as unknown as Actor)
  .name;
// @ts-expect-error - `nope` is not a column on the user table (proves not unknown/any)
void (null as unknown as Actor).nope;

// The hook infers the same actorUser shape from the typed client.
const withUserClient = createCMSClient<typeof withUserCms>()({
  baseURL: '/api/cms',
});
export const _hookActorIsTyped = () => {
  const res = useNotifications(withUserClient, { userId: 'u1', withUser: true });
  type HookActor = NonNullable<
    (typeof res.notifications)[number]['actorUser']
  >;
  const name: string | null | undefined = (null as unknown as HookActor).name;
  return name;
};

// --- the router narrows `meta` per notification type -----------------------
export const _router = createNotificationRouter({
  // core type → `meta` is typed as CoreNotificationMetaMap['mention']
  mention: (n) => {
    const messageId: string = n.meta.messageId;
    return { href: `/threads/${n.meta.threadId}#${messageId}` };
  },
  published: (n) => ({ href: `/${n.collection}/${n.resourceId}` }),
  fallback: (n) => ({ href: n.resourceId ? `/x/${n.resourceId}` : null }),
});

// `fallback` is required — routing must stay total.
export const _routerNeedsFallback = () =>
  // @ts-expect-error - missing required `fallback`
  createNotificationRouter({ published: () => ({ href: '/' }) });

// `meta` is narrowed: a non-existent key on a core type is a compile error.
export const _routerMetaNarrows = () =>
  createNotificationRouter({
    // @ts-expect-error - `nope` is not on mention's meta shape
    mention: (n) => ({ href: String(n.meta.nope) }),
    fallback: () => ({ href: null }),
  });

// --- a PLUGIN contributes a notification type; the router narrows its meta ----
const abPlugin = {
  id: 'abTest',
  notificationTypes: {
    abTestWinner: z.object({ testId: z.string(), variant: z.string() }),
  },
} satisfies CMSPlugin;

const cmsWithPlugin = createCMS({ db, media, collections, plugins: [abPlugin] });

// A plugin can emit its OWN type (emit side accepts any string).
export const _pluginCanEmit = () =>
  cmsWithPlugin.notify({
    recipientId: 'u1',
    actorId: 'u2',
    type: 'abTestWinner',
    title: 'You won',
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: { testId: 't1', variant: 'B' },
  });

export const _pluginRouter = createNotificationRouter<typeof cmsWithPlugin>({
  // core type still typed off CoreNotificationMetaMap
  mention: (n) => ({ href: `/threads/${n.meta.threadId}` }),
  // plugin type → `meta` typed from the plugin's Zod schema (via typeof cms)
  abTestWinner: (n) => {
    const testId: string = n.meta.testId;
    return { href: `/experiments/${testId}` };
  },
  fallback: () => ({ href: null }),
});

// plugin `meta` is narrowed: a non-existent key is a compile error.
export const _pluginMetaNarrows = () =>
  createNotificationRouter<typeof cmsWithPlugin>({
    // @ts-expect-error - `nope` is not on abTestWinner's meta shape
    abTestWinner: (n) => ({ href: String(n.meta.nope) }),
    fallback: () => ({ href: null }),
  });

// --- REGRESSION: a CMS with NO notification-type plugin still types core meta --
// Without stripping the empty registry's index signature, KnownNotificationType
// widens to `string` and `n.meta` collapses to `never`. `enabled` has no plugins.
export const _routerNoPluginCmsTypesCoreMeta = () =>
  createNotificationRouter<typeof enabled>({
    mention: (n) => ({ href: `/threads/${n.meta.threadId}` }),
    fallback: () => ({ href: null }),
  });

// The discriminating check: a bad meta key MUST still error here. If `n.meta`
// had collapsed to `never`, `n.meta.nope` would be allowed and this
// `@ts-expect-error` would go unused → tsc fails.
export const _routerNoPluginMetaNarrows = () =>
  createNotificationRouter<typeof enabled>({
    // @ts-expect-error - `nope` is not on mention's meta shape
    mention: (n) => ({ href: String(n.meta.nope) }),
    fallback: () => ({ href: null }),
  });
