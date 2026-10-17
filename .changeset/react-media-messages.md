---
'@createcms/react': minor
---

`@createcms/react/media` reads every visible string from a messages catalog.
`Media.Root` takes a partial `messages` catalog and a `locale`;
`defaultMediaMessages`, `mergeMediaMessages`, `createMediaFormatters`,
`mediaErrorMessage` and `useMediaMessages` are exported. Sizes, numbers,
dates, remaining time and plurals use `Intl` with the locale, and error
codes map to catalog texts instead of server messages. The root crumb
defaults to `Library`. `CmsMediaUploadFileState` carries `optimize`
instead of `optimized` and `originalVariantId`.
