---
"@createcms/core": patch
---

`createcms generate` no longer silently no-ops in CI. Previously, when the output
file already existed and there was no interactive terminal to prompt, generation
was "cancelled" and the process exited 0 — so a stale committed schema sailed
through CI. Now:

- A new `--force` flag overwrites the output file without prompting (use it in
  your `cms:generate` script for CI).
- Without `--force`, an existing output file that can't be confirmed (non-TTY) —
  or a declined interactive prompt — exits with a non-zero code instead of a
  silent success.
