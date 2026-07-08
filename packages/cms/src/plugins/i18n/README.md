# i18n Plugin

Server-only plugin that scopes content by language for `@createcms/core`. Each root belongs to one language, sibling-language versions of an entry are tied together by a translation group, and reads fall back along a chain you configure. See [/docs/plugins/i18n](/docs/plugins/i18n) for the full guide.

> ⚠️ **Work in progress — not production-ready.** Part of [createCMS](https://github.com/weepaho3/createCMS), which is pre-1.0 and has **not been tested in production**. APIs may change.

## Installation

Pass the static set of `languages` as a `const` tuple (so they become a typed union) and a `defaultLanguage` that is a member of it. Your `authMiddleware` must return the active `language` for each request:

```typescript
import { createCMS } from '@createcms/core';
import {
  i18n,
  resolveLanguage,
  type I18nMiddlewareResult,
} from '@createcms/core/plugins/i18n';

const cms = createCMS({
  db,
  collections,
  media: {
    /* ... */
  },
  plugins: [
    i18n({
      languages: ['en', 'de', 'fr'],
      defaultLanguage: 'en',
      fallback: { de: ['en'], fr: ['en'] },
    }),
  ],
  authMiddleware: async (
    ctx,
  ): Promise<I18nMiddlewareResult<'en' | 'de' | 'fr'>> => {
    const session = await getSession(ctx);
    const language = resolveLanguage(ctx, session.locale) ?? 'en';
    return { userId: session.userId, language }; // TS enforces `language`
  },
});
```

The plugin adds language columns, so regenerate and migrate the schema after installing (`npx createcms generate`, then your Drizzle migration workflow).

`I18nConfig` options: `languages` is the static universe of supported languages (a `const` tuple → a typed union); `defaultLanguage` is the seed + default fallback target and must be a member of `languages`; `fallback` is an optional `Partial<Record<language | 'default', language[]>>` of per-language fallback chains (`'default'` is the catch-all; absent → fall back to `defaultLanguage`; an explicit `[]` opts a language out of any fallback). Invalid `defaultLanguage` or `fallback` keys/entries throw at construction.

## How It Works

1. The plugin adds a `language` (and `translationKey`) column to `roots`, and a `language` column to `redirects`, `templates`, and `variables`, via schema extensions.
2. During `init`, it registers a `ScopeConditionFactory` that reads `language` from the middleware result and validates it against the configured universe.
3. On every request, that factory scopes reads/writes to the active language: a `WHERE language = …` on `roots`, `redirects`, and `templates`, plus a matching `insertColumns` stamp. `variables` are stamped on insert but resolved with the **fallback chain** on read (no hard `where`).
4. A new logical entry mints a fresh `translationKey` (a `tgr_` group id); sibling-language versions inherit it via `createTranslation`. The resolved i18n context (active language + fallback chain + universe) is stashed in the opaque `pluginContext.i18n` slot — read it with the exported `getI18nContext(scope)`.

Core routes apply these conditions automatically — they have no knowledge of languages.

## What the Plugin Adds

### Schema extensions

The `language` and `translationKey` columns do **not** exist in the core schema; they are owned entirely by this plugin via `definePluginSchema`.

| Table       | Column / Index                                        | Purpose                                                    |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------- |
| `roots`     | `language` column (text, NOT NULL)                    | The entry's language                                       |
| `roots`     | `translationKey` column (text, NOT NULL)              | Stable group id tying sibling-language entries together    |
| `roots`     | `(language, collection, parentRootId, slug)` UNIQUE   | Per-language slug uniqueness for nested roots              |
| `roots`     | `(translationKey, language)` UNIQUE (archived excl.)  | At most one active sibling per group per language          |
| `redirects` | `language` column + `(language, collection)` index    | Per-language redirect routing                              |
| `templates` | `language` column + `(language, collection, blockType)` index | Per-language block/field defaults                  |
| `variables` | `language` column + `(language, key)` index           | Per-language variables (resolved with fallback on read)    |

### Endpoints

Contributed to every collection (via `plugin.collectionEndpoints`), so they surface at `cms.api.<collection>.*` **only** when this plugin is installed:

| Endpoint            | Method | Purpose                                                                                  |
| ------------------- | ------ | ---------------------------------------------------------------------------------------- |
| `createTranslation` | POST   | Create the sibling-language version of an entry — inherits its `translationKey`, takes the target language, seeds from the source's `main` tree (`seed: 'copy'`) or blank. Body: `sourceRootId`, `targetLanguage`, `targetSlug?`, `seed?`, `message?`. |
| `listTranslations`  | GET    | Return the existing sibling-language versions of an entry (language switcher / status). Query: `rootId`. |

### Error codes

| Code                                | Status | Description                                                     |
| ----------------------------------- | ------ | --------------------------------------------------------------- |
| `LANGUAGE_REQUIRED`                 | 400    | `authMiddleware` did not return a `language`.                   |
| `LANGUAGE_NOT_ENABLED`              | 400    | The resolved language is not one of the configured `languages`. |
| `TRANSLATION_SOURCE_NOT_FOUND`      | 404    | Source root not found in the active language / tenant.          |
| `TRANSLATION_EXISTS`                | 409    | A translation in the target language already exists.            |
| `TRANSLATION_PARENT_NOT_TRANSLATED` | 409    | The source's parent has no translation in the target language.  |
| `TRANSLATION_LANGUAGE_NOT_ENABLED`  | 400    | `targetLanguage` is not one of the configured `languages`.      |

Codes are typed into the API error union via `InferPluginErrorCodes` when the plugin is installed.

## Types

### `I18nMiddlewareResult`

Extends the core `MiddlewareResult` with a required `language` field:

```typescript
type I18nMiddlewareResult<L extends string = string> =
  MiddlewareResult & {
    language: L;
  };
```

Use this type for your `authMiddleware` return value to get compile-time enforcement. `L` is the language union from your configured `languages`.

### Helpers

| Export            | Description                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `i18n(config)`    | Plugin factory — pass your `I18nConfig`.                                                          |
| `resolveLanguage` | Reads an explicit per-request language override (`body.language` → `query.language` → fallback).  |
| `getI18nContext`  | Reads the resolved `I18nContext` (active language + fallback chain + universe) from a `ResolvedScope`. |
