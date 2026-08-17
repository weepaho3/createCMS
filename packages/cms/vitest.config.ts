import { defineConfig } from 'vitest/config';

/**
 * Directory-level coverage floors (test-01).
 *
 * Every number was measured from a full `bun run test:coverage` run and then
 * parked a few points BELOW that baseline, so the gate catches a real slide
 * rather than ordinary churn. Small directories get a wider margin because a
 * single uncovered function there is worth several percent.
 *
 * These are a ratchet, not a target: when a directory climbs clear of its
 * floor, raise the floor. Never lower one to make a run pass — that is the
 * regression the gate exists to report.
 *
 * Vitest checks each glob set independently AND checks the global set against
 * every file, so a glob entry is a stricter floor for that directory, never an
 * exemption from the global one. Globs are matched against paths relative to
 * this config's directory.
 *
 * Branch coverage is the number that matters for the merge machinery
 * (`core/routes/merges.ts`, `core/diff`, `core/blocks`): its logic is a chain
 * of three-way base/source/target conditions where every line is trivially
 * reachable but the interesting cases live in the branches.
 */
const coverageThresholds = {
  // Whole package. Dragged down by the deliberately thin areas below, so it is
  // a backstop against a broad slide rather than a meaningful quality bar.
  lines: 81,
  statements: 79,
  functions: 78,
  branches: 72,

  // The engine — server logic, well covered, and where regressions hurt most.
  'src/core/**': {
    lines: 90,
    statements: 87,
    functions: 90,
    branches: 78,
  },
  // The HTTP surface. Endpoint behaviour is exercised end-to-end against
  // PGlite, so this stays high.
  'src/core/routes/**': {
    lines: 91,
    statements: 88,
    functions: 93,
    branches: 78,
  },
  // `buildMergedSnapshot` lives here: nine conditional arms deciding one
  // block's fate from base/source/target. The fragile logic in the repo.
  'src/core/routes/merges.ts': {
    lines: 90,
    statements: 88,
    functions: 93,
    branches: 74,
  },
  // Snapshot reconstruction and commit writing — the other half of the merge
  // path, and what every read of a block tree goes through.
  'src/core/blocks/**': {
    lines: 92,
    statements: 87,
    functions: 90,
    branches: 74,
  },
  // Three-way diff and classification feeding the merge decisions.
  'src/core/diff/**': {
    lines: 95,
    statements: 93,
    functions: 95,
    branches: 88,
  },
  // Plugins are uneven by nature: some are fully covered, others (media-optimize,
  // the Upstash-backed sinks) need infrastructure the suite does not boot.
  'src/plugins/**': {
    lines: 67,
    statements: 66,
    functions: 62,
    branches: 62,
  },
  // React entries: the render paths are covered under happy-dom, the
  // subscription/transport wrappers largely are not.
  'src/react/**': {
    lines: 74,
    statements: 73,
    functions: 68,
    branches: 70,
  },
  'src/next/**': {
    lines: 80,
    statements: 78,
    functions: 62,
    branches: 73,
  },
  // Thin on purpose, for now. The client core is covered indirectly through the
  // React and integration suites, and the CLI is exercised by hand more than by
  // test. Both floors are low so they are honest — they exist to stop the
  // remaining coverage from evaporating, not to claim these areas are done.
  // Raising them is tracked in CMS-33 (client) and CMS-34 (cli).
  'src/client/**': {
    lines: 28,
    statements: 27,
    functions: 24,
    branches: 28,
  },
  'src/cli/**': {
    lines: 23,
    statements: 22,
    functions: 30,
    branches: 16,
  },
};

export default defineConfig({
  test: {
    testTimeout: 15_000,
    // PGlite keeps a ~200MB WASM heap per worker that Linux never reclaims
    // (see src/test-utils/db.ts). Unbounded workers OOM a 16GB runner.
    // CI shards pass the same cap on the CLI; this is the default for
    // `bun run test`, coverage, watch, and the release job.
    maxWorkers: 2,
    // Releases every PGlite a test opened as soon as it ends — without this
    // the suite leaks WASM instances until worker exit and can exhaust
    // machine memory (see vitest.setup.ts).
    setupFiles: ['./vitest.setup.ts'],
    // Coverage is opt-in locally (`bun run test:coverage`), so this config is
    // inert for a normal `vitest run`. CI enables it on every test shard and
    // enforces the thresholds once, on the merged report — see the `coverage`
    // job in .github/workflows/ci.yml. React render paths run under happy-dom
    // via per-file `// @vitest-environment happy-dom`.
    coverage: {
      provider: 'v8',
      // `*.{ts,tsx}` rather than `**`: a bare `src/**` hands the v8 provider
      // every README.md and asset in the tree, which it then fails to parse
      // and drops, one stack trace at a time.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/test/**',
        'src/test-utils/**',
        'src/**/*.d.ts',
        'src/**/*.type-check.ts',
        'src/**/*.type-check.tsx',
        'src/core/db/schema.generated.ts',
        'src/schema.ts',
      ],
      reporter: ['text', 'text-summary', 'lcov'],
      // A `--shard` run only executes a slice of the suite, so its coverage
      // numbers are a fraction of the truth and every threshold would fail.
      // CI's shards set COVERAGE_THRESHOLDS=off and the merged report enforces
      // them instead; locally the default (enforced) is what you want.
      thresholds:
        process.env.COVERAGE_THRESHOLDS === 'off'
          ? undefined
          : coverageThresholds,
    },
  },
});
