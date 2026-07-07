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

### Repo map

| Path | What it is | Run it |
| --- | --- | --- |
| [`packages/cms`](./packages/cms) | `@createcms/core` — the package under active development. Tests run against an in-memory Postgres (PGlite), so no database is needed. | `bun run --filter=@createcms/core test` |
| [`apps/docs`](./apps/docs) | The documentation site (Fumadocs); content lives in [`apps/docs/content/docs`](./apps/docs/content/docs). | `bun run --filter=docs dev` → <http://localhost:4000> |
| [`examples/minimal`](./examples/minimal), [`examples/blog`](./examples/blog) | Runnable example apps (PGlite in-memory, no DB setup). | `bun run --filter=<name> dev` |

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
5. Open a pull request. CI runs lint, type-check, test, and build.

## Code style

- TypeScript, formatted with **oxfmt** (single quotes, 80 cols) and linted with
  **oxlint**. Run `bun run format` before committing.
- Conventional, descriptive commit messages are appreciated.

## Releases

Releases are automated via [Changesets](https://github.com/changesets/changesets):
merging the "Version Packages" PR publishes to npm with provenance. Maintainers
handle releases — contributors just add a changeset.

**Recovery:** publish and tagging are not atomic. If a release run dies after
`npm publish` but before the tags are pushed (npm has the new version, but the
git tag / GitHub release is missing), recreate the tags:

```bash
bunx changeset tag   # tag every already-published version
git push --tags
```
