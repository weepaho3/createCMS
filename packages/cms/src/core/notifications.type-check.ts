// Type-only assertions for the notifications config gate. Checked by
// `check-types` (tsc --noEmit over src), not executed. If the gating breaks,
// the `@ts-expect-error` below becomes unused and tsc fails — so this file is
// self-verifying.

import { createCMSClient } from '../client/vanilla';
import { useNotifications } from '../react/realtime';
import { defineCollections } from './define';
import { createCMS } from './factory';
import type { DrizzleInstance } from './types/drizzle';
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
