---
'@createcms/core': patch
'@createcms/react': patch
---

The media alt AI plugin. `mediaAltAi({ describe })` from
`@createcms/core/plugins/media-alt-ai` adds `mediaAltAi.suggestAlt`, which
describes an image of the caller's scope with your vision model, with the
block context in the prompt, a per-actor rate limit and no writes.
`chromeAltSuggester()` and `serverAltSuggester(call)` from
`/plugins/media-alt-ai/client` are suggesters for `ImageField.Root`: Chrome's
built-in model when it is already on the device, then the server.
`AltSuggestAdapter` gains an optional `available()`, `canSuggestAlt` reports
whether any suggester is available, and `ImageField.SuggestAlt` is left out
while none is.
