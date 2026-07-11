import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../../test-utils/cms';

const testUserTable = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  image: text('image'),
  passwordHash: text('password_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

const USER_ID = 'user-1';

async function setupWithUsers(authUserId: string | undefined = USER_ID) {
  const { cms, db } = await setupTestCMS({
    user: {
      table: testUserTable,
      idColumn: testUserTable.id,
      // NB: `passwordHash` is deliberately NOT exposed — the reads must never
      // leak it.
      exposeColumns: ['name', 'email', 'image', 'createdAt'],
    },
    authMiddleware: async () => ({ userId: authUserId }),
  });

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      image TEXT,
      password_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  await db.execute(sql`
    INSERT INTO "user" (id, name, email, image, password_hash) VALUES
      ('user-1', 'Alice', 'alice@example.com', 'https://cdn.test/a.png', 'secret-a'),
      ('user-2', 'Bob', 'bob@example.com', NULL, 'secret-b')
  `);

  return { cms, db };
}

describe('users endpoints — registration', () => {
  it('exposes users.whoami and users.listReviewers on the api', async () => {
    const { cms } = await setupTestCMS();
    expect(typeof cms.api.users.whoami).toBe('function');
    expect(typeof cms.api.users.listReviewers).toBe('function');
  });
});

describe('users.whoami', () => {
  it('returns the current user id and its exposed row', async () => {
    const { cms } = await setupWithUsers();

    const result = await cms.api.users.whoami();

    expect(result.userId).toBe(USER_ID);
    expect(result.user).toMatchObject({
      id: USER_ID,
      name: 'Alice',
      email: 'alice@example.com',
      image: 'https://cdn.test/a.png',
    });
    // Never leaks a non-exposed column.
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('password_hash');
  });

  it('returns null user when the id matches no row', async () => {
    const { cms } = await setupWithUsers('ghost-user');

    const result = await cms.api.users.whoami();

    expect(result.userId).toBe('ghost-user');
    expect(result.user).toBeNull();
  });

  it('returns null user when no user.table is configured', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_ID }),
    });

    const result = await cms.api.users.whoami();

    expect(result.userId).toBe(USER_ID);
    expect(result.user).toBeNull();
  });

  it('returns null userId when unauthenticated', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: undefined }),
    });

    const result = await cms.api.users.whoami();

    expect(result.userId).toBeNull();
    expect(result.user).toBeNull();
  });
});

describe('users.listReviewers', () => {
  it('returns every user as { id, ...exposeColumns }', async () => {
    const { cms } = await setupWithUsers();

    const reviewers = await cms.api.users.listReviewers();

    expect(Array.isArray(reviewers)).toBe(true);
    expect(reviewers.map((r) => r.id)).toEqual(['user-1', 'user-2']);

    const alice = reviewers.find((r) => r.id === 'user-1')!;
    expect(alice).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect(alice).not.toHaveProperty('passwordHash');
    expect(alice).not.toHaveProperty('password_hash');

    // A user with a null exposed column still comes back (id always present).
    const bob = reviewers.find((r) => r.id === 'user-2')!;
    expect(bob).toMatchObject({ name: 'Bob', image: null });
  });

  it('honors limit/offset pagination', async () => {
    const { cms } = await setupWithUsers();

    const page = await cms.api.users.listReviewers({
      query: { limit: 1, offset: 1 },
    });

    expect(page.map((r) => r.id)).toEqual(['user-2']);
  });

  it('returns an empty array when no user.table is configured', async () => {
    const { cms } = await setupTestCMS({
      authMiddleware: async () => ({ userId: USER_ID }),
    });

    const reviewers = await cms.api.users.listReviewers();

    expect(reviewers).toEqual([]);
  });
});
