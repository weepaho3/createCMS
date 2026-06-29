import { useCallback, useEffect, useState } from 'react';

import type {
  ListNotificationsResult,
  NotificationListItem,
} from '../core/notifications/types';

import { notificationEvent } from '../core/notifications/events';

/** The slice of the CMS client this hook needs (structurally satisfied by the
 *  real typed client's `notifications` namespace). */
type NotificationsClient = {
  notifications: {
    listNotifications: (query?: {
      limit?: number;
      withUser?: boolean;
    }) => Promise<ListNotificationsResult>;
  };
};

export type UseNotificationsOptions = {
  /**
   * The current user's id — used to subscribe to the private
   * `notif:<userId>` channel. The server authorizes it against the session, so
   * a wrong id only yields a poll-only fallback, never another user's data.
   */
  userId: string;
  /** The CMS API base URL (the same value passed to `createCMSClient`). */
  baseURL: string;
  /** Page size for the seed / reconcile poll (default 50). */
  limit?: number;
  /**
   * Include actor-user data in the listed notifications. Note: live-pushed
   * items do not carry `actorUser` (only the poll resolves it) — a freshly
   * pushed row gains it on the next reconcile (reconnect / error).
   */
  withUser?: boolean;
};

export type NotificationsState = {
  notifications: NotificationListItem[];
  unreadCount: number;
};

export type UseNotificationsResult = NotificationsState & {
  /** Whether the realtime stream is currently connected. */
  isLive: boolean;
  /** Force a re-poll (reconcile against the durable list). */
  refresh: () => void;
};

/**
 * Apply a pushed notification to the current state — prepend it and bump the
 * unread count, but ONLY if it is genuinely new (de-duped by id). De-duping the
 * list AND the count together (rather than in separate setters) is what keeps
 * `unreadCount` from drifting when a push and a poll race. Pure — the reducing
 * core, unit-tested.
 */
export function mergePushedNotification(
  state: NotificationsState,
  pushed: NotificationListItem,
): NotificationsState {
  if (state.notifications.some((n) => n.id === pushed.id)) return state;
  return {
    notifications: [pushed, ...state.notifications],
    unreadCount: state.unreadCount + (pushed.readAt ? 0 : 1),
  };
}

/**
 * Decode an SSE data frame into a pushed notification for `userId`, or null if
 * it isn't one we should apply. Returns null for: system frames (they carry a
 * top-level `type`), non-`notification` events, payloads that fail the
 * `notificationEvent` schema, and — defense-in-depth — any payload whose
 * `recipientId` isn't the subscriber (the server already authorizes the
 * channel, this is a second guard). Pure — unit-tested.
 */
export function pushedNotificationFromFrame(
  frame: unknown,
  userId: string,
): NotificationListItem | null {
  if (!frame || typeof frame !== 'object') return null;
  const f = frame as Record<string, unknown>;
  if (typeof f.type === 'string') return null; // system frame
  if (f.event !== 'notification') return null;
  const parsed = notificationEvent.safeParse(f.data);
  if (!parsed.success || parsed.data.recipientId !== userId) return null;
  // readAt is absent on the wire (the schema omits it) and a just-created
  // notification is always unread — so a pushed item is unread by construction.
  return { ...parsed.data, readAt: null } as NotificationListItem;
}

/**
 * Real-time notifications for the current user.
 *
 * Seeds list + unread count from the durable `listNotifications` poll, then
 * subscribes to the user's own `notif:<userId>` SSE channel and prepends pushed
 * notifications live. The poll is the reconciling source of truth: it runs on
 * mount, on (re)connect, and on error, so a dropped or duplicated push
 * self-corrects. The stream is best-effort — if realtime is unavailable the
 * hook degrades to the seeded poll.
 *
 * Self-managed `EventSource` (no provider to wire): just call it. Opened with
 * `withCredentials` so the session cookie authenticates the connection.
 *
 * Pass a referentially-STABLE `client` and `baseURL` (e.g. a module-level
 * client) — a new identity each render tears down and reopens the stream.
 */
export function useNotifications(
  client: NotificationsClient,
  options: UseNotificationsOptions,
): UseNotificationsResult {
  const { userId, baseURL, limit = 50, withUser } = options;
  const [state, setState] = useState<NotificationsState>({
    notifications: [],
    unreadCount: 0,
  });
  const [isLive, setIsLive] = useState(false);

  const refresh = useCallback(() => {
    client.notifications
      .listNotifications({ limit, withUser })
      .then((res) =>
        setState({
          notifications: res.notifications,
          unreadCount: res.unreadCount,
        }),
      )
      .catch(() => {});
  }, [client, limit, withUser]);

  useEffect(() => {
    // Seed immediately so the list shows without waiting for the stream to
    // connect (and so poll-only degradation actually polls).
    refresh();

    let cancelled = false;
    let current: EventSource | null = null;

    function open() {
      if (cancelled) return;
      const url = `${baseURL}/realtime?channel=notif:${encodeURIComponent(userId)}`;
      let socket: EventSource;
      try {
        socket = new EventSource(url, { withCredentials: true });
      } catch {
        return; // no EventSource (unsupported runtime) — the seeded poll stands
      }
      current = socket;
      // Gate every handler: ignore a socket that has been superseded (reconnect)
      // or torn down (unmount), so a stale/queued callback can't mutate state.
      const isStale = () => cancelled || socket !== current;

      socket.onopen = () => {
        if (isStale()) return;
        setIsLive(true);
        refresh(); // reconcile drift accumulated before the stream opened
      };

      socket.onmessage = (event: MessageEvent) => {
        if (isStale()) return;
        let frame: unknown;
        try {
          frame = JSON.parse(event.data as string);
        } catch {
          return;
        }
        if (!frame || typeof frame !== 'object') return;
        const f = frame as Record<string, unknown>;
        // System frames carry `type`; data frames are the { id, data, event,
        // channel } envelope (the notification's own `type` lives at f.data.type).
        if (typeof f.type === 'string') {
          if (f.type === 'reconnect') {
            // Server self-terminates near its serverless duration — re-open.
            socket.close();
            open();
          } else if (f.type === 'error' || f.type === 'disconnected') {
            setIsLive(false);
            refresh(); // stream degraded — reconcile via the poll
          }
          return;
        }
        const pushed = pushedNotificationFromFrame(f, userId);
        if (!pushed) return;
        setState((prev) => mergePushedNotification(prev, pushed));
      };

      socket.onerror = () => {
        if (isStale()) return;
        setIsLive(false);
        refresh(); // poll is the reconciling source of truth
      };
    }

    open();

    return () => {
      cancelled = true;
      current?.close();
      current = null;
      setIsLive(false);
    };
  }, [userId, baseURL, refresh]);

  return {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    isLive,
    refresh,
  };
}
