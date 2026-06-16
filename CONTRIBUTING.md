# Contributing to createCMS

Thanks for your interest in contributing! 🎉

## Development setup

createCMS is a [bun](https://bun.sh) + [turbo](https://turbo.build) monorepo.

```bash
git clone https://github.com/createcms/createcms.git
cd createcms
bun install
```

### Useful commands

```bash
bun run build         # build all packages (bunchee)
bun run check-types   # type-check (tsc --noEmit)
bun run test          # run the test suite (vitest + PGlite — no external DB needed)
bun run lint          # oxlint
bun run format        # oxfmt --write
```

The package under active development lives in [`packages/cms`](./packages/cms)
(`@createcms/core`). Its tests run against an in-memory Postgres (PGlite), so
you do not need a database to run them.

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
