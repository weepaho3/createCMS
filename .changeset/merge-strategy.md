---
"@createcms/core": patch
---

Add a configurable merge strategy for `executeMerge`.

- **`mergeStrategy`** (CMS config) — `'fast-forward'` (default) or `'merge-commit'`. Controls how `executeMerge` integrates when a fast-forward is possible (the target has not diverged). `'merge-commit'` always records an explicit merge commit (git's `--no-ff`) so every integration is visible in history. A diverged target always produces a merge commit regardless.
- **`executeMerge({ noFastForward })`** — per-call override of the configured strategy. `true` forces a merge commit, `false` forces a fast-forward.

A merge with nothing to integrate (the source and target heads are already equal) stays a no-op fast-forward even under `noFastForward`/`'merge-commit'`, so no empty merge commit is fabricated. Default behavior is unchanged (`'fast-forward'`).
