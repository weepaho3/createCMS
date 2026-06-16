# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets).

To record a change for the next release, run:

```bash
bunx changeset
```

Pick the affected package(s) and a semver bump (patch / minor / major), and write
a short summary. The summary becomes the changelog entry. On merge to `main`, the
release workflow opens a "version packages" PR; merging that publishes to npm.
