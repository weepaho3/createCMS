import { APIError } from 'better-call';
import { sql } from 'drizzle-orm';

import type {
  CMSMiddlewareRequest,
  MiddlewareResult,
  ResolvedScope,
  ScopeConditionFactory,
} from '../../core/types/definitions';
import type { CMSPlugin } from '../../core/types/plugin';

import { newId, registerIdPrefix } from '../../utils/nanoid';
import { createI18nCollectionEndpoints } from './collection-endpoints';
import { $ERROR_CODES } from './errors';
import { buildI18nReferenceResolver } from './reference-resolver';
import { i18nSchema } from './schema';
import { buildI18nVariableResolver } from './variable-resolver';

// The translation-group id prefix is owned by this plugin (core no longer
// declares it). Registered at import so newId('translationGroup') works in
// the per-new-entry mint below.
registerIdPrefix('translationGroup', 'tgr');

/**
 * Extends the core MiddlewareResult to require `language`. Use this to type your
 * authMiddleware when the i18n plugin is active. `L` is the language union from
 * the configured `languages` universe (e.g. 'en' | 'de').
 *
 * @example
 * ```ts
 * import { resolveLanguage } from '@createcms/core/plugins/i18n';
 *
 * authMiddleware: async (ctx): Promise<I18nMiddlewareResult<'en' | 'de'>> => {
 *   const session = await getSession(ctx);
 *   const language = resolveLanguage(ctx, session.locale) ?? 'en';
 *   return { userId: session.userId, language };
 * }
 * ```
 */
export type I18nMiddlewareResult<L extends string = string> =
  MiddlewareResult & {
    language: L;
  };

/**
 * Resolves the active language from the incoming request context.
 * Priority: body.language, then query.language, then fallback.
 *
 * The CMS is routing-agnostic: how you derive the language (URL prefix `/de`,
 * domain, Accept-Language header, cookie) is the consumer's middleware concern.
 * This helper only reads an explicit per-request override; pass the negotiated
 * default as `fallback`.
 */
export function resolveLanguage(
  ctx: { request?: CMSMiddlewareRequest },
  fallback?: string,
): string | undefined {
  return (
    (ctx.request?.body?.language as string | undefined) ??
    (ctx.request?.query?.language as string | undefined) ??
    fallback
  );
}

export type I18nContext = {
  language: string;
  fallback: readonly string[];
  languages: readonly string[];
};

/**
 * Read the resolved i18n context (active language, fallback chain, configured
 * universe) from a ResolvedScope. The plugin's own accessor for the opaque
 * `pluginContext.i18n` slot it stashes per request; core never names i18n.
 * Undefined when the i18n plugin did not scope the request.
 */
export function getI18nContext(
  scope: ResolvedScope | undefined,
): I18nContext | undefined {
  return scope?.pluginContext?.['i18n'] as I18nContext | undefined;
}

const PLUGIN_ID = 'i18n' as const;

/**
 * i18n plugin config. `languages` is the static universe of supported
 * languages (a const tuple giving a typed language union); `defaultLanguage`
 * is the seed and fallback head and must be a member of the universe.
 * Per-tenant activation of a subset is a runtime concern handled by the
 * consumer's middleware (it returns the active `language`); this plugin
 * validates that the active language is in the universe.
 */
export type I18nConfig<L extends readonly string[]> = {
  languages: L;
  defaultLanguage: L[number];
  /**
   * Per-language fallback chains (ordered languages to try after the active
   * one when a translation is missing). `default` is the catch-all for
   * languages not listed; absent means every language falls back to
   * `defaultLanguage`. An explicit empty array opts a language out of any
   * fallback (`{ de: [] }` leaves a missing `de` translation unresolved).
   * Example: `{ default: ['en'], 'fr-CA': ['fr', 'en'] }`.
   */
  fallback?: Partial<Record<L[number] | 'default', readonly L[number][]>>;
};

/**
 * The ordered fallback chain for `activeLang`: languages to try after it,
 * with the active language removed and duplicates dropped.
 */
function resolveFallbackChain<L extends readonly string[]>(
  config: I18nConfig<L>,
  activeLang: string,
): string[] {
  const fb = config.fallback as Record<string, readonly string[]> | undefined;
  const base = fb?.[activeLang] ??
    fb?.default ?? [config.defaultLanguage as string];
  const seen = new Set<string>([activeLang]);
  const chain: string[] = [];
  for (const l of base) {
    if (!seen.has(l)) {
      seen.add(l);
      chain.push(l);
    }
  }
  return chain;
}

export function i18n<const L extends readonly string[]>(config: I18nConfig<L>) {
  const universe = new Set<string>(config.languages as readonly string[]);
  if (!universe.has(config.defaultLanguage as string)) {
    throw new Error(
      `i18n: defaultLanguage "${config.defaultLanguage}" must be one of languages [${config.languages.join(', ')}]`,
    );
  }
  // Catch fallback-config typos at construction (like defaultLanguage): keys
  // must be a configured language or 'default'; every chain entry must be a
  // language.
  if (config.fallback) {
    for (const [key, chain] of Object.entries(
      config.fallback as Record<string, readonly string[]>,
    )) {
      if (key !== 'default' && !universe.has(key)) {
        throw new Error(
          `i18n: fallback key "${key}" is not one of languages [${config.languages.join(', ')}]`,
        );
      }
      for (const lang of chain ?? []) {
        if (!universe.has(lang)) {
          throw new Error(
            `i18n: fallback for "${key}" references unknown language "${lang}"`,
          );
        }
      }
    }
  }

  return {
    id: PLUGIN_ID,

    schema: i18nSchema,

    $ERROR_CODES,

    // Per-collection endpoints: createTranslation / listTranslations surface
    // at cms.api.<collection>.x only because this plugin is installed. The
    // configured language universe is closed in here so the endpoints validate
    // a target language without reading per-request scope.
    collectionEndpoints: (def, ctx) =>
      createI18nCollectionEndpoints(
        def,
        ctx,
        config.languages as readonly string[],
      ),

    init(_ctx) {
      const factory: ScopeConditionFactory = (mwResult) => {
        const language = (mwResult as Record<string, unknown>).language;

        if (typeof language !== 'string' || language.length === 0) {
          throw new APIError(400, {
            message: $ERROR_CODES.LANGUAGE_REQUIRED.message,
            code: 'LANGUAGE_REQUIRED',
          });
        }
        if (!universe.has(language)) {
          throw new APIError(400, {
            message: $ERROR_CODES.LANGUAGE_NOT_ENABLED.message,
            code: 'LANGUAGE_NOT_ENABLED',
          });
        }

        const fallback = resolveFallbackChain(config, language);

        // Blanket per-language scoping on `roots`, exactly like multi-tenant's
        // tenant_slug (per-locale context): `where` scopes every roots
        // read/guard to the active language, `insertColumns` stamps it on every
        // create. Cross-language operations (language switcher / translation
        // status) are served by dedicated translationKey endpoints; they query
        // by group id, not the blanket scope.
        return {
          roots: {
            where: sql`"cms"."roots"."language" = ${language}`,
            insertColumns: { language },
            // A new logical entry mints a fresh translation group id;
            // sibling-language roots inherit it later via createTranslation.
            newEntryColumns: () => ({
              translation_key: newId('translationGroup'),
            }),
            // `language` is stamped on insert but is a cross-scope column for
            // reads: a reference/host/usage in any sibling language still
            // counts, so cross-scope read queries must not filter by it.
            crossScopeExclude: ['language'],
          },
          // Redirects are per-language: a redirect created for `en` must not
          // fire for a `de` visitor, and the two languages can have different
          // redirects for the same path. The resolver, CRUD and auto-create all
          // consume scope.redirects, so this is the whole wiring.
          redirects: {
            where: sql`"cms"."redirects"."language" = ${language}`,
            insertColumns: { language },
          },
          // Templates are per-language: a default for the same field can differ
          // per language (e.g. German vs English boilerplate). createBlock
          // applies the active language's defaults; CRUD is language-scoped.
          templates: {
            where: sql`"cms"."templates"."language" = ${language}`,
            insertColumns: { language },
          },
          // Variables are per-language but resolved with fallback on read, so
          // there is intentionally no `where` here (the chain, not a hard
          // equality, picks the language). `language` is stamped on insert;
          // CRUD targets the exact active-language cell via the
          // variableScopeConditions helper, and content rendering rides the
          // variableResolver below.
          variables: {
            insertColumns: { language },
          },
          // Active-language-with-fallback variable resolution for content reads.
          variableResolver: buildI18nVariableResolver(language, fallback),
          // The reference resolver core's read path and the co-render walk ride
          // through the handle: translation-group aware (tgr_ to the best
          // fallback sibling; rot_ to the active-language sibling, else anchor).
          referenceResolver: buildI18nReferenceResolver(language, fallback),
          // Per-request i18n context (active language + fallback chain + the
          // configured universe), stashed in the opaque pluginContext slot
          // keyed by this plugin's id. Core never reads it; consumers read it
          // via the exported getI18nContext(scope) accessor.
          pluginContext: {
            i18n: {
              language,
              fallback,
              languages: config.languages as readonly string[],
            },
          },
        };
      };

      return {
        context: {
          scopeConditions: [factory],
        },
      };
    },
  } satisfies CMSPlugin;
}
