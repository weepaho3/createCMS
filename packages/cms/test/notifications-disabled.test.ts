import { describe, expect, it } from 'vitest';

import { coreSchemaFor } from '../src/cli/commands/generate';
import { setupTestCMS } from './utils/cms';

type CoreSchema = {
  tables: Record<string, unknown>;
  enums: Record<string, unknown>;
};

describe('notifications: false — schema gating (coreSchemaFor)', () => {
  it('keeps the notifications table + notification_type enum when enabled', () => {
    const schema = coreSchemaFor(true) as CoreSchema;
    expect(schema.tables.notifications).toBeDefined();
    expect(schema.enums.notificationType).toBeDefined();
  });

  it('drops the notifications table + notification_type enum when disabled', () => {
    const schema = coreSchemaFor(false) as CoreSchema;
    expect(schema.tables.notifications).toBeUndefined();
    expect(schema.enums.notificationType).toBeUndefined();
    // Other core tables/enums survive (only the notifications pair is removed).
    expect(schema.tables.branches).toBeDefined();
    expect(Object.keys(schema.enums).length).toBeGreaterThan(0);
  });
});

describe('notifications: false — runtime gating', () => {
  it('disables notify, the service, and the route', async () => {
    const { cms } = await setupTestCMS({ notifications: false });
    expect(cms.notify).toBeUndefined();
    expect(cms.notificationService).toBeUndefined();
    expect((cms.api as Record<string, unknown>).notifications).toBeUndefined();
  });

  it('keeps notify + the service + the route when enabled (default)', async () => {
    const { cms } = await setupTestCMS();
    expect(cms.notify).toBeTypeOf('function');
    expect(cms.notificationService).toBeDefined();
    expect((cms.api as Record<string, unknown>).notifications).toBeDefined();
  });
});
