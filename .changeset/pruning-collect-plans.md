---
'@createcms/core': patch
---

chore(pruning): remove the unused, unbudgeted collectRootExecutionPlans export

`collectRootExecutionPlans` loaded every root with no limit and then serially ran the full per-root planning bundle (`planRootPruning` + `collectPluginPruningPlans`) with no bound — an unbounded N+1 whose memory footprint grows with root count. It had zero callers anywhere in the repo, was never re-exported from the package entrypoint, and had no `./admin` subpath to reach it externally. The production entry point, `runPruningPass`, already does the budgeted equivalent directly (bounded by `maxRoots`/`maxDurationMs`), so this was dead code — not a reachable dry-run/reporting API. Removed.
