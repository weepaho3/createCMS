# Contributing to createCMS

Thanks for your interest in contributing! 🎉

This project has a [Code of Conduct](./CODE_OF_CONDUCT.md) — by participating, you
agree to uphold it.

## Where to start

New to the project? Browse issues labelled
[`good first issue`](https://github.com/weepaho3/createCMS/labels/good%20first%20issue)
and [`help wanted`](https://github.com/weepaho3/createCMS/labels/help%20wanted).
For questions, ideas, and design discussion, use
[GitHub Discussions](https://github.com/weepaho3/createCMS/discussions) rather than
opening an issue.

## Development setup

createCMS is a [bun](https://bun.sh) + [turbo](https://turbo.build) monorepo. It
pins **bun 1.2.23** (see `packageManager` in `package.json`); install that version
or newer.

```bash
git clone https://github.com/weepaho3/createCMS.git createcms
cd createcms
bun install
```

### Useful commands

```bash
bun run build         # build all packages (bunchee)
bun run check-types   # type-check every workspace (tsc --noEmit)
bun run test          # run the test suite once (vitest + PGlite — no external DB needed)
bun run lint          # oxlint
bun run format        # oxfmt --write
```

Run the tests in watch mode from the package itself:

```bash
bun run --filter=@createcms/core test:watch
```

### Coverage

```bash
bun run --filter=@createcms/core test:coverage
```

CI enforces per-directory coverage floors, defined in
[`packages/cms/vitest.config.ts`](./packages/cms/vitest.config.ts). They are a
ratchet: each one sits a few points under the measured baseline, `core/**` and
the merge machinery (`core/routes/merges.ts`, `core/blocks`, `core/diff`) are
held to stricter numbers than `cli` or `client`, and the number to watch on the
merge path is _branch_ coverage, not lines.

The command above checks the same floors locally. If a directory climbs clear of
its floor, raise the floor in the same PR. Do not lower one to get a run green —
that drop is the regression the gate is there to report.

CI itself does not run coverage separately: the four test shards run instrumented
and write `--reporter=blob` reports, and a `coverage` job merges them and checks
the thresholds against the whole suite.

### Repo map

| Path                                                                         | What it is                                                                                                                            | Run it                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`packages/cms`](./packages/cms)                                             | `@createcms/core` — the package under active development. Tests run against an in-memory Postgres (PGlite), so no database is needed. | `bun run --filter=@createcms/core test`                                                             |
| [`packages/schema`](./packages/schema)                                       | `@createcms/schema` — runtime-free type vocabulary shared by core and react.                                                          | `bun run --filter=@createcms/schema check-types`                                                    |
| [`packages/react`](./packages/react)                                         | `@createcms/react` — headless editor primitives.                                                                                      | `bun run --filter=@createcms/react test`, browser: `bun run --filter=@createcms/react test:browser` |
| [`apps/docs`](./apps/docs)                                                   | The documentation site (Fumadocs); content lives in [`apps/docs/content/docs`](./apps/docs/content/docs).                             | `bun run --filter=docs dev` → <http://localhost:4000>                                               |
| [`examples/minimal`](./examples/minimal), [`examples/blog`](./examples/blog) | Runnable example apps (PGlite in-memory, no DB setup).                                                                                | `bun run --filter=<name> dev`                                                                       |

### Package layout (`packages/cms/src`)

Every `src/` entry mirrors a subpath in `package.json`'s `exports` map (the CLI is
the `bin` entry):

```
packages/cms/src/
  index.ts            # main entry (the "." export); db.ts · nanoid.ts are thin
                      # export entries (schema.ts is internal — test-only, not exported)
  core/               # framework-agnostic engine — all server logic
    routes/           #   better-call endpoint definitions — the HTTP surface
    <domain>/         #   per-domain logic: blocks, media, notifications, search,
                      #   redirects, realtime, user, storage, db, codegen, admin
    types/            #   shared types
    factory.ts router.ts context.ts define.ts …   # wiring/logic at core root
  cli/                # the createcms CLI (commands/ templates/ utils/)
  bin/createcms.ts    # #! shim → cli (the "bin" entry)
  client/             # framework-agnostic client core (proxy, build, config, vanilla)
  react/              # React entries: index, blocks, realtime, variant, tracking
  next/               # Next.js adapters (./next, ./next/middleware)
  ab-edge/            # framework-agnostic edge A/B core (./ab-edge)
  plugins/<name>/     # self-contained plugins (own schema/endpoints/client + README)
  test-utils/         # shared test helpers (setupTestCMS, fixtures, db bootstrap)
```

**Where new code goes:** an endpoint goes in `core/routes/`; the logic it calls
lives in `core/<domain>/`. A plugin is self-contained under `plugins/<name>/`. Any
new `src/` entry must be added to the `exports` map to ship.

**Where tests go:** unit tests co-locate next to the code in `src/**/test/`; broader
integration tests that spin up a full CMS live in the package-level
[`test/`](./packages/cms/test). Shared helpers live in `src/test-utils/` (imported by
both). Both trees are type-checked — `tsconfig` includes `src` and `test`.

## Submitting changes

1. Fork + branch from `main`.
2. Make your change, with tests where it makes sense.
3. Ensure `bun run check-types`, `bun run test`, and `bun run lint` pass.
4. **Add a changeset** describing your change:
   ```bash
   bunx changeset
   ```
   Pick the bump (patch/minor/major) and write a short summary — this becomes
   the changelog entry and drives the next release.
5. Open a pull request. CI runs lint, type-check, test, coverage, and build.

## Commit conventions

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<scope>)!: <subject>

<body>

BREAKING CHANGE: <what breaks, and what to do instead>
```

- **type** — one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`,
  `ci`, `chore`, `style`, `revert`.
- **scope** — optional but encouraged; the area touched (`media`, `blocks`,
  `routes`, `cli`, `react`, `next`, `release`, …).
- **subject** — imperative, lower-case, no trailing period.

Pull requests are **squash-merged**, so the PR title becomes the commit subject on
`main`. That title is what the convention applies to, and what CI checks — write it
in this format even if the branch's individual commits are messier.

### Marking breaking changes

A change is breaking if a consumer on the previous version has to do something to
keep working. That includes:

- removed or renamed public API (exports, endpoints, config keys, types);
- a changed request or response shape, URL, or wire format;
- validation that rejects input previously accepted;
- a newly required config option, or a raised Node / peer-dependency floor;
- a database schema change that needs a regenerate + migration.

Mark it in **all four** places — the marker is not optional, and a `breaking` label
on the Linear issue is the signal that the PR closing it must carry one:

1. **`!` in the subject** — `feat(media)!: address the gate by asset id`.
2. **A `BREAKING CHANGE:` footer** in the body, naming the migration. This is the
   text future readers actually use, so write it for someone upgrading, not for a
   reviewer.
3. **A `minor` changeset** — pre-1.0, minor is the breaking channel (see
   [Versioning](#versioning) below).
4. **An entry in [`BREAKING-CHANGES.md`](./BREAKING-CHANGES.md)** under
   `## Unreleased`, in the same PR. That file is the answer to "what broke since
   version X?" and is the source for the migration guides; the release moves the
   `Unreleased` entries under the new version heading.

The `breaking` Linear label is the upstream hint. The commit marker, the changeset
and the `BREAKING-CHANGES.md` entry are the record.

### What CI checks

The `commits` job runs on every pull request:

```bash
bun run check-commit "feat(media)!: address the gate by asset id"
```

It verifies that the PR title parses as a conventional commit, that a
`BREAKING CHANGE:` footer (if present) is spelled and placed correctly, and — the
point of the whole exercise — that a PR carrying a **`minor` changeset for a
published `@createcms` package** (`@createcms/core`, `@createcms/schema` or
`@createcms/react`) also carries a `!` or a `BREAKING CHANGE:` footer. Pre-1.0
those two things mean the same thing, so they must not disagree.

Alongside `commits`, CI runs: `test` (the `@createcms/core` suite, 4 shards +
merged coverage), `test-react` (the `@createcms/react` node/happy-dom suite,
plus a type-check of `@createcms/schema` and `@createcms/react`),
`browser-tests` (the `@createcms/react` suite in real Chromium via Playwright
— skipped when nothing under `packages/react`, `packages/schema`, `bun.lock`
or the CI workflow changed), and `build` (every package, plus `publint` and
`@arethetypeswrong/cli` for the three published packages).

## Versioning

createCMS is pre-1.0, so **minor is the breaking channel**. Choose the changeset
bump accordingly:

- **patch** — non-breaking only: bug fixes, internal changes, additive behaviour
  that does not alter existing public API or wire formats.
- **minor** — anything that removes or renames public API, or changes a wire or
  URL format (for example the media-gate URL scheme). These are breaking pre-1.0
  and must not ship as a patch.

`@createcms/core`, `@createcms/schema` and `@createcms/react` are versioned
independently (Changesets, no `linked`/`fixed`); a bump of `@createcms/schema`
bumps `@createcms/react`'s dependency range on it in the same version PR.

Every release's breaks are collected in
[`BREAKING-CHANGES.md`](./BREAKING-CHANGES.md), covering 0.2.0 onwards.

### Deprecation policy

**Pre-1.0 there is no deprecation window.** Breaking changes are applied cleanly in
a minor — no aliases, no compat shims — because carrying two spellings of an API
this early costs more than it saves. Deprecation is still the better move whenever
the old form can keep working at no cost: mark it `@deprecated` in JSDoc, name the
replacement in the tag, keep it working for at least one minor, and remove it in a
later one. The removal is itself a breaking change and gets the full marker
treatment above.

**From 1.0 on**, the policy tightens: public API is removed only in a major, is
marked `@deprecated` (with the replacement named) for at least one full minor
release before that, and its removal is listed in `BREAKING-CHANGES.md` when the
deprecation lands — not when the removal does — so consumers get the whole window
to react.

## Code style

- TypeScript, formatted with **oxfmt** (single quotes, 80 cols) and linted with
  **oxlint**. Run `bun run format` before committing.
- Commit messages follow [Conventional Commits](#commit-conventions).

## Releases

Releases are automated via [Changesets](https://github.com/changesets/changesets):
merging the "Version Packages" PR publishes to npm with provenance. Maintainers
handle releases — contributors just add a changeset.

### Packages

| Package             | Directory                              | What it is                                             |
| ------------------- | -------------------------------------- | ------------------------------------------------------ |
| `@createcms/core`   | [`packages/cms`](./packages/cms)       | The composable, block-based headless CMS.              |
| `@createcms/schema` | [`packages/schema`](./packages/schema) | Runtime-free type vocabulary shared by core and react. |
| `@createcms/react`  | [`packages/react`](./packages/react)   | Headless editor primitives.                            |

### First publish of a new package (maintainer checklist)

1. From the branch that makes the package publishable: `bun install && bunx turbo run build --filter=<pkg>`; `cd packages/<dir> && npm publish --access public` with an npm account that owns the `@createcms` scope (2FA / granular token — this is the only publish that ever uses a token).
2. On npmjs.com → package → Settings → Publishing access: choose "Require two-factor authentication and disallow tokens", and add a **Trusted publisher**: GitHub Actions, organization/user `weepaho3`, repository `createCMS`, workflow `release.yml`, environment empty.
3. Merge the PR. From now on the release workflow publishes the package with OIDC + provenance like `@createcms/core`.
4. Verify with the next release: add a `patch` changeset for the package, merge the "Version Packages" PR, check that the run's `Create release PR or publish` step lists the package and that npmjs.com shows the provenance badge.

(Note the order: publish first, then merge — the release workflow runs on every push to `main` and would try to publish an unregistered name otherwise.)

**Recovery:** publish and tagging are not atomic. If a release run dies after
`npm publish` but before the tags are pushed (npm has the new version, but the
git tag / GitHub release is missing), recreate the tags:

```bash
bunx changeset tag   # tag every already-published version
git push --tags
```
