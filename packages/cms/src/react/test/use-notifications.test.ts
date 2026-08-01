// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Serialize } from '../../client/types';
import type { ListNotificationsResult } from '../../core/notifications/types';

// Hoisted mock of the shared realtime client. `useRealtime` captures the hook's
// `onData` callback (and reports a connected status); the test-only `__push`
// re-invokes it with a wire envelope, standing in for a server SSE frame.
vi.mock('@upstash/realtime/client', () => {
  let onData: ((arg: { data: unknown }) => void) | undefined;
  return {
    createRealtime: () => ({
      useRealtime: (o: { onData: (arg: { data: unknown }) => void }) => {
        onData = o.onData;
        return { status: 'connected' };
      },
    }),
    RealtimeProvider: ({ children }: { children?: unknown }) => children,
    __push: (data: unknown) => onData?.({ data }),
  };
});

import * as rt from '@upstash/realtime/client';

import { useNotifications } from '../realtime';

type SeededList = Serialize<ListNotificationsResult<Record<string, unknown>>>;

// A full, wire-valid seed row (createdAt as an ISO string, matching the poll's
// serialized shape).
const seedItem = {
  id: 'n1',
  recipientId: 'u1',
  actorId: null,
  type: 'comment',
  title: 'Seed notification',
  body: null,
  resourceType: null,
  resourceId: null,
  collection: null,
  meta: null,
  readAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
} satisfies SeededList['notifications'][number];

// A full wire item satisfying the `notificationEventSchema` zod schema — anything that
// fails `safeParse` (or targets another recipient) is dropped by `onData`.
function wireItem(over: Record<string, unknown>) {
  return {
    id: 'n2',
    recipientId: 'u1',
    actorId: null,
    type: 'comment',
    title: 'Pushed notification',
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: null,
    createdAt: '2026-07-05T00:00:00.000Z',
    ...over,
  };
}

describe('useNotifications', () => {
  afterEach(() => cleanup());

  it('seeds from the poll, then merges live pushes (prepend, dedupe, recipient-filter)', async () => {
    const list = vi.fn(
      async (): Promise<SeededList> => ({
        notifications: [seedItem],
        total: 1,
        hasMore: false,
        unreadCount: 1,
      }),
    );
    const client = { notifications: { list } };

    const { result } = renderHook(() =>
      useNotifications(client, { userId: 'u1', limit: 50 }),
    );

    // After the seed poll resolves: one notification, unread 1, settled state.
    await waitFor(() => {
      expect(result.current.notifications).toHaveLength(1);
    });
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.isLive).toBe(true);
    expect(list).toHaveBeenCalledWith({
      query: { limit: 50, withUser: undefined },
    });

    // A live push for this user is prepended and bumps the unread count.
    act(() => {
      (rt as unknown as { __push: (d: unknown) => void }).__push(wireItem({}));
    });
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.notifications[0].id).toBe('n2');
    expect(result.current.unreadCount).toBe(2);

    // A push addressed to a different recipient is dropped by the onData guard.
    act(() => {
      (rt as unknown as { __push: (d: unknown) => void }).__push(
        wireItem({ id: 'n3', recipientId: 'someone-else' }),
      );
    });
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(2);

    // A duplicate id is de-duped (list AND count stay put).
    act(() => {
      (rt as unknown as { __push: (d: unknown) => void }).__push(wireItem({}));
    });
    expect(result.current.notifications).toHaveLength(2);
    expect(result.current.unreadCount).toBe(2);
  });
});
