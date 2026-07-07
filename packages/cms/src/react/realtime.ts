import {
  createElement,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

import {
  createRealtime,
  RealtimeProvider as UpstashRealtimeProvider,
} from '@upstash/realtime/client';

import type {
  ListNotificationsResult,
  NotificationListItem,
} from '../core/notifications/types';

import { notificationEvent } from '../core/notifications/events';
import {
  mergePushedNotification,
  type NotificationsState,
} from '../core/notifications/merge';

export type RealtimeProviderProps = {
  children: ReactNode;
  /**
   * The CMS API base URL — the same value passed to `createCMSClient`. The
   * provider opens ONE shared connection to `${baseURL}/realtime` with
   * credentials (the route is cookie-authenticated and must be same-origin).
   */
  baseURL: string;
  /** Max reconnect attempts before giving up (default 3). */
  maxReconnectAttempts?: number;
};

/**
 * Wraps your app in ONE shared realtime connection that every CMS realtime hook
 * (`useNotifications`, the A/B `useLiveResults`) rides. A thin wrapper over
 * Upstash's provider that derives the endpoint + credentials from `baseURL`:
 *
 * ```tsx
 * <RealtimeProvider baseURL="/api/cms">{children}</RealtimeProvider>
 * ```
 */
export function RealtimeProvider({
  children,
  baseURL,
  maxReconnectAttempts,
}: RealtimeProviderProps) {
  return createElement(UpstashRealtimeProvider, {
    api: { url: `${baseURL}/realtime`, withCredentials: true },
    maxReconnectAttempts,
    children,
  });
}

/** The slice of the CMS client this hook needs (structurally satisfied by the
 *  real typed client's `notifications` namespace). `TActorUser` is inferred from
 *  the client's `list` return, so a typed client flows its
 *  `actorUser` shape straight through to the hook result. */
type NotificationsClient<TActorUser = Record<string, unknown>> = {
  notifications: {
    // `withUser` matches the client's `WithUserQuery` (`true`, never `boolean`),
    // so a real typed CMS client is assignable without a cast.
    list: (opts?: {
      query?: { limit?: number; withUser?: true };
    }) => Promise<ListNotificationsResult<TActorUser>>;
  };
};

export type UseNotificationsOptions = {
  /**
   * The current user's id — used to subscribe to the private `notif:<userId>`
   * channel (the server authorizes it against the session). Optional: pass it
   * straight from your auth session (`session?.user?.id`); while it is undefined
   * the hook stays poll-only and connects once it resolves. The CMS has no
   * "current user" endpoint, so your app supplies the id.
   */
  userId?: string;
  /** Page size for the seed / reconcile poll (default 50). */
  limit?: number;
  /** Pass `true` to enrich the seeded list with actor-user data (`actorUser`).
   *  Live-pushed items already carry `actorUser` from the wire, so the actor is
   *  available immediately on a push too. */
  withUser?: true;
};

export type { NotificationsState };

export type UseNotificationsResult<TActorUser = Record<string, unknown>> =
  NotificationsState<TActorUser> & {
    /** Whether the shared realtime connection is currently connected. */
    isLive: boolean;
    /** Force a re-poll (reconcile against the durable list). */
    refresh: () => void;
  };

const { useRealtime } = createRealtime<{
  notification: typeof notificationEvent;
}>();

/**
 * Real-time notifications for the current user.
 *
 * Seeds list + unread count from the durable `list` poll, then
 * subscribes to the user's own `notif:<userId>` channel over the shared
 * {@link RealtimeProvider} connection. Pushes are prepended live and de-duped by
 * id; the provider replays anything missed across a reconnect, and the poll
 * covers the initial backlog and offline gaps. Requires the app to be wrapped
 * in a `RealtimeProvider`.
 *
 * Pass a referentially-STABLE `client` (a module-level singleton, as
 * `createCMSClient` recommends) — a new identity each render re-fires the seed
 * poll.
 */
export function useNotifications<TActorUser = Record<string, unknown>>(
  client: NotificationsClient<TActorUser>,
  options: UseNotificationsOptions,
): UseNotificationsResult<TActorUser> {
  const { userId, limit = 50, withUser } = options;
  const [state, setState] = useState<NotificationsState<TActorUser>>({
    notifications: [],
    unreadCount: 0,
  });

  const refresh = useCallback(() => {
    client.notifications
      .list({ query: { limit, withUser } })
      .then((res) =>
        setState({
          notifications: res.notifications,
          unreadCount: res.unreadCount,
        }),
      )
      .catch(() => {});
  }, [client, limit, withUser]);

  useEffect(() => {
    refresh(); // seed the durable backlog
  }, [refresh]);

  const { status } = useRealtime({
    // Connect only once the userId is known — poll-only until then, no
    // `notif:undefined` subscription, no `userId ?? ''` workaround.
    enabled: Boolean(userId),
    channels: [`notif:${userId}`],
    events: ['notification'],
    onData({ data }) {
      // `createdAt` is a string on the wire — `notificationEvent` coerces it —
      // and the recipient check is defense-in-depth over the server's authz.
      const parsed = notificationEvent.safeParse(data);
      if (!parsed.success || parsed.data.recipientId !== userId) return;
      // The wire event carries `actorUser`, so a live push shows the actor
      // immediately — no wait for the next reconcile poll.
      const pushed = {
        ...parsed.data,
        readAt: null,
      } as NotificationListItem<TActorUser>;
      setState((prev) => mergePushedNotification(prev, pushed));
    },
  });

  return {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    isLive: status === 'connected',
    refresh,
  };
}
