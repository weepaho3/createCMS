import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import type { ResolvedUserConfig } from '../src/core/user/resolve';

import {
  extractUserFromRow,
  resolveUserColumns,
  userJoinFragments,
} from '../src/core/user/join-helpers';
import { resolveUserConfig } from '../src/core/user/resolve';
import { setupTestCMS } from './utils/cms';

// ---------------------------------------------------------------------------
// Test user table (Drizzle definition — used for metadata resolution)
// ---------------------------------------------------------------------------

const testUserTable = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  image: text('image'),
  role: text('role'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// resolveUserConfig
// ============================================================================

describe('resolveUserConfig', () => {
  it('resolves table metadata correctly', () => {
    const resolved = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });

    expect(resolved.tableName).toBe('user');
    expect(resolved.idColumnKey).toBe('id');
    expect(resolved.idColumnDbName).toBe('id');
    expect(resolved.sqlTableRef).toBe('"user"');
    expect(resolved.allColumns).toHaveProperty('id');
    expect(resolved.allColumns).toHaveProperty('name');
    expect(resolved.allColumns).toHaveProperty('email');
    expect(resolved.allColumns).toHaveProperty('image');
  });

  it('distinguishes idColumnKey from idColumnDbName', () => {
    const tableWithMappedId = pgTable('account', {
      accountId: text('account_id').primaryKey(),
      name: text('name').notNull(),
    });
    const resolved = resolveUserConfig({
      table: tableWithMappedId,
      idColumn: tableWithMappedId.accountId,
    });
    expect(resolved.idColumnKey).toBe('accountId');
    expect(resolved.idColumnDbName).toBe('account_id');
  });

  it('throws when idColumn does not belong to the table', () => {
    const otherTable = pgTable('other', {
      otherId: text('other_id').primaryKey(),
    });
    expect(() =>
      resolveUserConfig({ table: testUserTable, idColumn: otherTable.otherId }),
    ).toThrow(/idColumn "other_id" not found/);
  });
});

// ============================================================================
// resolveUserColumns
// ============================================================================

describe('resolveUserColumns', () => {
  let uc: ResolvedUserConfig;

  it('returns all non-id columns when withUser is true', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const cols = resolveUserColumns(uc, true);
    expect(cols).not.toContain('id');
    expect(cols).toContain('name');
    expect(cols).toContain('email');
    expect(cols).toContain('image');
    expect(cols).toContain('role');
    expect(cols).toContain('createdAt');
  });

  it('returns only requested columns when withUser is a map', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const cols = resolveUserColumns(uc, { name: true, image: true });
    expect(cols).toEqual(['name', 'image']);
  });

  it('ignores requested columns that do not exist on the table', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const cols = resolveUserColumns(uc, {
      name: true,
      nonexistent: true,
    } as any);
    expect(cols).toEqual(['name']);
  });

  it('returns empty array for empty withUser map', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const cols = resolveUserColumns(uc, {});
    expect(cols).toEqual([]);
  });

  it('correctly excludes ID column even when camelCase key differs from DB name', () => {
    const tableWithDifferentIdName = pgTable('account', {
      accountId: text('account_id').primaryKey(),
      displayName: text('display_name').notNull(),
    });
    uc = resolveUserConfig({
      table: tableWithDifferentIdName,
      idColumn: tableWithDifferentIdName.accountId,
    });
    const cols = resolveUserColumns(uc, true);
    expect(cols).not.toContain('accountId');
    expect(cols).toContain('displayName');
  });

  describe('exposeColumns allowlist (security boundary)', () => {
    it('drops columns not on the allowlist even when explicitly requested', () => {
      const allowlisted = resolveUserConfig({
        table: testUserTable,
        idColumn: testUserTable.id,
        exposeColumns: ['name', 'image'],
      });
      // `email` and `role` exist on the table but are NOT allowlisted.
      const cols = resolveUserColumns(allowlisted, {
        name: true,
        email: true,
        role: true,
      } as Record<string, true>);
      expect(cols).toEqual(['name']);
      expect(cols).not.toContain('email');
      expect(cols).not.toContain('role');
    });

    it('withUser: true returns only allowlisted columns', () => {
      const allowlisted = resolveUserConfig({
        table: testUserTable,
        idColumn: testUserTable.id,
        exposeColumns: ['name', 'image'],
      });
      const cols = resolveUserColumns(allowlisted, true);
      expect(cols.sort()).toEqual(['image', 'name']);
      expect(cols).not.toContain('email');
      expect(cols).not.toContain('createdAt');
    });

    it('never exposes the id column, even if listed in exposeColumns', () => {
      const allowlisted = resolveUserConfig({
        table: testUserTable,
        idColumn: testUserTable.id,
        exposeColumns: ['id', 'name'],
      });
      const cols = resolveUserColumns(allowlisted, true);
      expect(cols).not.toContain('id');
      expect(cols).toContain('name');
    });
  });
});

// ============================================================================
// userJoinFragments
// ============================================================================

describe('userJoinFragments', () => {
  let uc: ResolvedUserConfig;

  it('produces non-empty SQL fragments for valid columns', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const frags = userJoinFragments(
      uc,
      'cms.merge_requests.created_by',
      'mr_user',
      { name: true, image: true },
    );

    const selectStr = frags.selectColumns.queryChunks
      .map((c: any) => c.value ?? c)
      .join('');
    const joinStr = frags.joinClause.queryChunks
      .map((c: any) => c.value ?? c)
      .join('');

    expect(selectStr).toContain('mr_user.name AS mr_user_name');
    expect(selectStr).toContain('mr_user.image AS mr_user_image');
    expect(joinStr).toContain('LEFT JOIN "user" AS mr_user');
    expect(joinStr).toContain('ON mr_user.id = cms.merge_requests.created_by');
  });

  it('returns empty fragments when no columns match', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const frags = userJoinFragments(uc, 'x', 'y', {});

    const selectStr = frags.selectColumns.queryChunks
      .map((c: any) => c.value ?? c)
      .join('');
    expect(selectStr).toBe('');
  });

  it('includes GROUP BY fragments', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const frags = userJoinFragments(uc, 'tbl.user_id', 'u', {
      name: true,
      email: true,
    });

    const groupByStr = frags.groupByColumns.queryChunks
      .map((c: any) => c.value ?? c)
      .join('');
    expect(groupByStr).toContain('u.name');
    expect(groupByStr).toContain('u.email');
  });
});

// ============================================================================
// extractUserFromRow
// ============================================================================

describe('extractUserFromRow', () => {
  let uc: ResolvedUserConfig;

  it('extracts user data from aliased row keys', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const row = {
      id: 'mr-1',
      created_by: 'user-1',
      mr_user_name: 'Alice',
      mr_user_image: 'https://example.com/alice.jpg',
    };
    const user = extractUserFromRow(row, 'mr_user', uc, {
      name: true,
      image: true,
    });
    expect(user).toEqual({
      name: 'Alice',
      image: 'https://example.com/alice.jpg',
    });
  });

  it('returns null when all user columns are null (no JOIN match)', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const row = {
      id: 'mr-1',
      mr_user_name: null,
      mr_user_image: null,
    };
    const user = extractUserFromRow(row, 'mr_user', uc, {
      name: true,
      image: true,
    });
    expect(user).toBeNull();
  });

  it('returns user object when some columns are null but others have values', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const row = {
      mr_user_name: 'Bob',
      mr_user_image: null,
    };
    const user = extractUserFromRow(row, 'mr_user', uc, {
      name: true,
      image: true,
    });
    expect(user).toEqual({ name: 'Bob', image: null });
  });

  it('returns null when row keys are missing entirely', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const row = { id: 'mr-1' };
    const user = extractUserFromRow(row, 'mr_user', uc, {
      name: true,
      image: true,
    });
    expect(user).toBeNull();
  });

  it('handles withUser=true correctly', () => {
    uc = resolveUserConfig({
      table: testUserTable,
      idColumn: testUserTable.id,
    });
    const row = {
      u_name: 'Charlie',
      u_email: 'charlie@test.com',
      u_image: null,
      u_role: 'admin',
      u_createdAt: '2025-01-01T00:00:00Z',
    };
    const user = extractUserFromRow(row, 'u', uc, true);
    expect(user).toBeDefined();
    expect(user!.name).toBe('Charlie');
    expect(user!.email).toBe('charlie@test.com');
    expect(user!.role).toBe('admin');
  });
});

// ============================================================================
// Integration: withUser through CMS API
// ============================================================================

describe('withUser integration', () => {
  const USER_ID = 'test-user-1';

  async function setupWithUser() {
    const { cms, db } = await setupTestCMS({
      user: {
        table: testUserTable,
        idColumn: testUserTable.id,
        exposeColumns: ['name', 'email', 'image', 'role', 'createdAt'],
      },
      authMiddleware: async () => ({ userId: USER_ID }),
    });

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        image TEXT,
        role TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      INSERT INTO "user" (id, name, email, image)
      VALUES (${USER_ID}, 'Test User', 'test@example.com', 'https://cdn.test/avatar.png')
    `);

    return { cms, db };
  }

  it('listMergeRequests returns createdByUser when withUser is set', async () => {
    const { cms } = await setupWithUser();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/test-mr-user', properties: { title: 'MR Test' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'New content' },
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Test MR',
        createdBy: USER_ID,
      },
    });

    const result = await (cms.api.pages.listMergeRequests as any)({
      query: {
        rootId: root.rootId,
        withUser: { name: true, image: true },
      },
    });

    expect(result.mergeRequests).toBeDefined();
    expect(result.mergeRequests.length).toBeGreaterThan(0);

    const mr = result.mergeRequests[0];
    expect(mr.createdBy).toBe(USER_ID);
    expect(mr.createdByUser).toBeDefined();
    expect(mr.createdByUser.name).toBe('Test User');
    expect(mr.createdByUser.image).toBe('https://cdn.test/avatar.png');
  });

  it('listMergeRequests omits createdByUser when withUser is not set', async () => {
    const { cms } = await setupWithUser();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/test-mr-no-user', properties: { title: 'No User' } },
    });

    const draft = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feature',
        sourceBranchId: root.branchId,
      },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: draft.branch.id,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Some content' },
      },
    });

    await cms.api.pages.createMergeRequest({
      body: {
        sourceBranchId: draft.branch.id,
        targetBranchId: root.branchId,
        title: 'Test MR',
        createdBy: USER_ID,
      },
    });

    const result = await cms.api.pages.listMergeRequests({
      query: { rootId: root.rootId },
    });

    expect(result.mergeRequests).toBeDefined();
    const mr = result.mergeRequests[0];
    expect(mr).not.toHaveProperty('createdByUser');
  });

  it('listRoots returns createdByUser when withUser is set', async () => {
    const { cms } = await setupWithUser();

    await cms.api.pages.createRoot({
      body: {
        slug: '/test-root-user',
        properties: { title: 'Root User Test' },
      },
    });

    const result = await (cms.api.pages.listRoots as any)({
      query: { withUser: { name: true, image: true } },
    });

    expect(result.roots).toBeDefined();
    expect(result.roots.length).toBeGreaterThan(0);

    const root = result.roots[0];
    expect(root.createdBy).toBe(USER_ID);
    expect(root.createdByUser).toBeDefined();
    expect(root.createdByUser.name).toBe('Test User');
    expect(root.createdByUser.image).toBe('https://cdn.test/avatar.png');
  });

  it('listRoots omits createdByUser when withUser is not set', async () => {
    const { cms } = await setupWithUser();

    await cms.api.pages.createRoot({
      body: {
        slug: '/test-root-no-user',
        properties: { title: 'No User' },
      },
    });

    const result = await cms.api.pages.listRoots({});

    expect(result.roots).toBeDefined();
    expect(result.roots.length).toBeGreaterThan(0);
    expect(result.roots[0]).not.toHaveProperty('createdByUser');
  });

  it('withUser=true returns all user fields', async () => {
    const { cms } = await setupWithUser();

    await cms.api.pages.createRoot({
      body: {
        slug: '/test-root-all-fields',
        properties: { title: 'All Fields' },
      },
    });

    const result = await (cms.api.pages.listRoots as any)({
      query: { withUser: true },
    });

    const root = result.roots[0];
    expect(root.createdBy).toBe(USER_ID);
    expect(root.createdByUser).toBeDefined();
    expect(root.createdByUser.name).toBe('Test User');
    expect(root.createdByUser.email).toBe('test@example.com');
    expect(root.createdByUser.image).toBe('https://cdn.test/avatar.png');
  });

  it('listBranches returns createdByUser when withUser is set', async () => {
    const { cms } = await setupWithUser();

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/test-branch-user',
        properties: { title: 'Branch Test' },
      },
    });

    const result = await (cms.api.pages.listBranches as any)({
      query: { rootId: root.rootId, withUser: { name: true } },
    });

    expect(result.branches).toBeDefined();
    expect(result.branches.length).toBeGreaterThan(0);
    const branch = result.branches[0];
    expect(branch.createdByUser).toBeDefined();
    expect(branch.createdByUser.name).toBe('Test User');
  });

  it('returns null createdByUser when user ID does not match any user', async () => {
    const OTHER_USER = 'nonexistent-user-999';
    const { cms, db } = await setupTestCMS({
      user: {
        table: testUserTable,
        idColumn: testUserTable.id,
        exposeColumns: ['name', 'email', 'image', 'role', 'createdAt'],
      },
      authMiddleware: async () => ({ userId: OTHER_USER }),
    });

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "user" (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        image TEXT,
        role TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      )
    `);

    await cms.api.pages.createRoot({
      body: {
        slug: '/test-unknown-user',
        properties: { title: 'Unknown User' },
      },
    });

    const result = await (cms.api.pages.listRoots as any)({
      query: { withUser: { name: true, image: true } },
    });

    expect(result.roots).toBeDefined();
    expect(result.roots.length).toBeGreaterThan(0);
    const root = result.roots[0];
    expect(root.createdBy).toBe(OTHER_USER);
    expect(root.createdByUser).toBeNull();
  });
});
