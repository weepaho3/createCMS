# Multi-Tenant Plugin

Server-only plugin that enables tenant-scoped data isolation in the CMS. Each request is associated with a tenant via the user's `authMiddleware`.

> ⚠️ **Work in progress — not production-ready.** Part of [createCMS](https://github.com/weepaho3/createCMS), which is pre-1.0 and has **not been tested in production**. APIs may change.

## Installation

```typescript
import { createCMS } from '@createcms/core';
import {
  multiTenant,
  type MultiTenantMiddlewareResult,
} from '@createcms/core/plugins/multi-tenant';

const cms = createCMS({
  db,
  collections,
  media: {/* ... */},
  plugins: [multiTenant()],
  authMiddleware: async (ctx): Promise<MultiTenantMiddlewareResult> => {
    const session = await getSession(ctx);
    return {
      userId: session.userId,
      tenantSlug: session.organizationSlug, // TS enforces this field
    };
  },
});
```

## How It Works

1. The plugin adds a `tenantSlug` column to `roots`, `assets`, and `asset_folders` via schema extensions.
2. During `init`, it registers a `ScopeConditionFactory` on the CMS context.
3. On every request, the endpoint wrapper calls the factory with the middleware result to produce per-table `WHERE` conditions and `INSERT` values.
4. Core routes apply these conditions automatically -- they have zero knowledge of tenants.

### Tenant Resolution Flow

```
Request → authMiddleware returns { userId, tenantSlug }
        → endpoint wrapper calls ScopeConditionFactory(mwResult)
        → factory produces WHERE + INSERT scopes per table
        → core routes apply scope.roots.where to queries
        → core routes spread scope.roots.insert into inserts
        → full tenant isolation without core knowing about tenants
```

No client-side tenant state is needed. Tenant isolation is purely a server-side per-request concern.

## What the Plugin Adds

### Schema Extensions

The plugin adds the `tenantSlug` column and tenant-scoped indexes to core tables:

| Table           | Column / Index                        | Purpose                                    |
| --------------- | ------------------------------------- | ------------------------------------------ |
| `roots`         | `tenantSlug` column (text, NOT NULL)  | Tenant identifier per root                 |
| `roots`         | `(tenantSlug, collection)` index      | Efficient tenant-scoped collection queries |
| `asset_folders` | `tenantSlug` column (text, NOT NULL)  | Tenant identifier per folder               |
| `asset_folders` | `(tenantSlug, parentId, name) UNIQUE` | Tenant-scoped folder name uniqueness       |
| `asset_folders` | `(tenantSlug)` index                  | Tenant-scoped folder lookups               |
| `assets`        | `tenantSlug` column (text, NOT NULL)  | Tenant identifier per asset                |
| `assets`        | `(tenantSlug)` index                  | Tenant-scoped asset lookups                |
| `assets`        | `(tenantSlug, slug) UNIQUE`           | Tenant-scoped slug uniqueness              |

The `tenantSlug` column does **not** exist in the core schema. It is entirely owned by this plugin and added via `definePluginSchema` extensions.

### Error Codes

| Code                   | Status | Description                                  |
| ---------------------- | ------ | -------------------------------------------- |
| `TENANT_SLUG_REQUIRED` | 400    | `authMiddleware` did not return `tenantSlug` |

## Types

### `MultiTenantMiddlewareResult`

Extends the core `MiddlewareResult` with a required `tenantSlug` field:

```typescript
type MultiTenantMiddlewareResult = MiddlewareResult & {
  tenantSlug: string;
};
```

Use this type for your `authMiddleware` return value to get compile-time enforcement.
