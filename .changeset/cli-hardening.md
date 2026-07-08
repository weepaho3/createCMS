---
"@createcms/core": patch
---

CLI hardening (wc-01, wc-04, wc-05).

- **`createcms generate` no longer silently drops plugin schemas** (wc-01). The
  subpath alias map is now derived from the package's own `exports` (so any
  exported plugin subpath, including the documented `@createcms/core/plugins/i18n`,
  resolves to its real module instead of an inert stub), the loader logs which
  specifiers were stubbed, and it now HARD-FAILS if a configured plugin resolved
  to the stub rather than emitting a schema with that plugin's tables missing. The
  config-loader shim also exposes `definePlugin` / `definePluginSchema`, so a
  config that authors a local plugin loads during generate instead of crashing.
- **`--force` / `--yes` for non-interactive generate** (wc-04). `createcms
  generate` over an existing schema in a non-TTY (CI) previously printed
  "cancelled" and exited 0, so a `cms:generate && drizzle-kit generate` step
  silently ran against a stale schema. It now exits non-zero in that case and
  accepts `--force` (alias `--yes`) to regenerate unattended.
- **Per-invocation temp dir for config loading** (wc-05, security). The loader
  wrote executable stub modules to a fixed shared `os.tmpdir()/createcms-stubs/`
  path with a silent-swallow on write failure, a local code-execution vector on
  multi-user hosts (an attacker could pre-plant a stub that runs in the victim's
  process during generate). It now uses a unique `mkdtemp` directory per run,
  cleaned up afterward, and fails hard instead of swallowing write errors.
