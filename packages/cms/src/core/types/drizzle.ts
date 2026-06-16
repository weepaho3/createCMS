import type { PgDatabase } from 'drizzle-orm/pg-core';

export type DrizzleInstance = PgDatabase<any, Record<string, unknown>, any>;
