import { pgTable, text } from 'drizzle-orm/pg-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleInstance } from '../../types/drizzle';
import type { NotificationInput, NotificationPayload } from '../types';

import { resolveUserConfig } from '../../user/resolve';
import { createNotificationService } from '../service';

const userTable = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name'),
  image: text('image'),
});

const resolvedUser = resolveUserConfig({
  table: userTable,
  idColumn: userTable.id,
  exposeColumns: ['name', 'image'],
});

/**
 * Minimal fake DB covering just the two chains the service uses: the insert
 * (returns the inserted values + synthesized id/createdAt) and `execute` (the
 * batched actor lookup `batchFetchUsers` runs). `executeImpl` lets each test
 * decide what the user lookup returns (or throw, for best-effort coverage).
 */
function fakeDb(
  executeImpl: () => Promise<{ rows: Array<Record<string, unknown>> }>,
): DrizzleInstance {
  return {
    insert() {
      return {
        values(vals: Record<string, unknown> | Record<string, unknown>[]) {
          const arr = Array.isArray(vals) ? vals : [vals];
          return {
            async returning() {
              return arr.map((v, i) => ({
                id: `n${i}`,
                createdAt: new Date('2026-01-01'),
                ...v,
              }));
            },
          };
        },
      };
    },
    execute: executeImpl,
  } as unknown as DrizzleInstance;
}

function input(over: Partial<NotificationInput> = {}): NotificationInput {
  return {
    recipientId: 'r1',
    actorId: 'a1',
    type: 'custom',
    title: 't',
    body: null,
    resourceType: null,
    resourceId: null,
    collection: null,
    meta: null,
    ...over,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('notification actor enrichment', () => {
  it('attaches actorUser (exposed columns) to the dispatched payload', async () => {
    const seen: NotificationPayload[] = [];
    const db = fakeDb(async () => ({
      rows: [{ user_id: 'a1', u_name: 'Alice', u_image: 'a.png' }],
    }));
    const service = createNotificationService(
      db,
      [(p) => void seen.push(p)],
      resolvedUser,
    );

    const payload = await service.notify(input({ actorId: 'a1' }));

    expect(payload.actorUser).toEqual({ name: 'Alice', image: 'a.png' });
    expect(seen[0]?.actorUser).toEqual({ name: 'Alice', image: 'a.png' });
  });

  it('sets actorUser to null when the actor has no matching user row', async () => {
    const db = fakeDb(async () => ({ rows: [] }));
    const service = createNotificationService(db, [], resolvedUser);

    const payload = await service.notify(input({ actorId: 'ghost' }));

    expect(payload.actorUser).toBeNull();
  });

  it('does not enrich without a user config (actorUser stays unset)', async () => {
    const db = fakeDb(async () => {
      throw new Error('execute should not be called');
    });
    const service = createNotificationService(db, []); // no resolvedUser

    const payload = await service.notify(input());

    expect(payload.actorUser).toBeUndefined();
  });

  it('batches a single lookup for many notifications (distinct actor ids)', async () => {
    const execute = vi.fn(async () => ({
      rows: [
        { user_id: 'a1', u_name: 'Alice', u_image: null },
        { user_id: 'a2', u_name: 'Bob', u_image: null },
      ],
    }));
    const service = createNotificationService(
      fakeDb(execute),
      [],
      resolvedUser,
    );

    const payloads = await service.notifyMany([
      input({ actorId: 'a1' }),
      input({ actorId: 'a2' }),
      input({ actorId: 'a1' }),
    ]);

    // one batched user query for the whole set, not one per notification
    expect(execute).toHaveBeenCalledTimes(1);
    expect(payloads.map((p) => (p.actorUser as { name: string }).name)).toEqual(
      ['Alice', 'Bob', 'Alice'],
    );
  });

  it('is best-effort: a lookup failure never drops the notification', async () => {
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = fakeDb(async () => {
      throw new Error('db down');
    });
    const service = createNotificationService(db, [], resolvedUser);

    const payload = await service.notify(input());

    expect(payload.id).toBe('n0');
    expect(payload.actorUser).toBeUndefined();
    expect(consoleErr).toHaveBeenCalled();
  });
});
