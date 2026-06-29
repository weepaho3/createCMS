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
 *  real typed client's `notifications` namespace). */
type NotificationsClient = {
  notifications: {
    listNotifications: (opts?: {
      query?: { limit?: number; withUser?: boolean };
    }) => Promise<ListNotificationsResult>;
  };
};

export type UseNotificationsOptions = {
  /**
   * The current user's id — used to subscribe to the private `notif:<userId>`
   * channel. The server authorizes it against the session, so a wrong id only
   * yields a poll-only fallback, never another user's data.
   */
  userId: string;
  /** Page size for the seed / reconcile poll (default 50). */
  limit?: number;
  /** Include actor-user data in the listed notifications. Note: live-pushed
   *  items do not carry `actorUser` until the next poll resolves it. */
  withUser?: boolean;
};

export type { NotificationsState };

export type UseNotificationsResult = NotificationsState & {
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
 * Seeds list + unread count from the durable `listNotifications` poll, then
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
export function useNotifications(
  client: NotificationsClient,
  options: UseNotificationsOptions,
): UseNotificationsResult {
  const { userId, limit = 50, withUser } = options;
  const [state, setState] = useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
  });

  const refresh = useCallback(() => {
    client.notifications
      .listNotifications({ query: { limit, withUser } })
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
    channels: [`notif:${userId}`],
    events: ['notification'],
    onData({ data }) {
      // `createdAt` is a string on the wire — `notificationEvent` coerces it —
      // and the recipient check is defense-in-depth over the server's authz.
      const parsed = notificationEvent.safeParse(data);
      if (!parsed.success || parsed.data.recipientId !== userId) return;
      const pushed = { ...parsed.data, readAt: null } as NotificationListItem;
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
