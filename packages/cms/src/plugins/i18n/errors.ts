import { APIError } from 'better-call';

/**
 * Error codes owned by the i18n plugin (typed into the API error union via
 * InferPluginErrorCodes when the plugin is installed). The LANGUAGE_* codes are
 * raised by the scope factory; the TRANSLATION_* codes by the per-collection
 * createTranslation/listTranslations endpoints.
 *
 * There is intentionally NO I18N_NOT_ENABLED code: createTranslation /
 * listTranslations only EXIST when this plugin is installed (they are
 * contributed via plugin.collectionEndpoints), so "i18n not enabled" is the
 * structural absence of the endpoint, not a runtime error.
 */
export const $ERROR_CODES = {
  LANGUAGE_REQUIRED: {
    status: 400 as const,
    message:
      'language is required -- authMiddleware must return { language } when the i18n plugin is active',
  },
  LANGUAGE_NOT_ENABLED: {
    status: 400 as const,
    message:
      'the resolved language is not one of the configured i18n languages',
  },
  TRANSLATION_SOURCE_NOT_FOUND: {
    status: 404 as const,
    message:
      'Translation source root not found in this collection / active language',
  },
  TRANSLATION_EXISTS: {
    status: 409 as const,
    message:
      'A translation in the target language already exists for this entry',
  },
  TRANSLATION_PARENT_NOT_TRANSLATED: {
    status: 409 as const,
    message:
      'The parent has no translation in the target language — translate the parent first',
  },
  TRANSLATION_LANGUAGE_NOT_ENABLED: {
    status: 400 as const,
    message: 'targetLanguage is not one of the configured i18n languages',
  },
} as const;

/** Throw a typed i18n plugin error (mirrors ab-test's abTestError). */
export function i18nError(
  code: keyof typeof $ERROR_CODES,
  message?: string,
): never {
  throw new APIError($ERROR_CODES[code].status, {
    message: message ?? $ERROR_CODES[code].message,
    code,
  });
}
