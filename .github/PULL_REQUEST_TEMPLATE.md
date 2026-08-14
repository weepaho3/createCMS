<!-- Thanks for contributing to createCMS! -->

<!--
The PR title is squash-merged as the commit subject on main, so write it as a
Conventional Commit: `type(scope): description`, with `!` before the colon if the
change is breaking (`feat(media)!: …`). CI checks it.
See CONTRIBUTING.md → "Commit conventions".
-->

## What does this PR do?

<!-- A short summary of the change and the motivation. Link any related issue. -->

## Checklist

- [ ] `bun run check-types` passes
- [ ] `bun run test` passes
- [ ] `bun run lint` passes
- [ ] Added a changeset (`bunx changeset`) if this changes published behavior
- [ ] Docs updated if needed

## Breaking change?

<!--
Breaking = a consumer on the previous version has to do something: renamed or
removed public API, a changed request/response shape, URL or wire format,
validation that rejects previously-accepted input, a newly required config, a
raised Node/peer floor, or a schema change needing a migration.

If it is NOT breaking, delete this section. If it IS, tick all four and add the
footer as the last line of this description, outside any comment:

BREAKING CHANGE: `duplicateBlock` now requires `targetParentBlockId`; use
`duplicateRoot` to duplicate a subtree into a new top-level entry.

CI fails a `minor` changeset that carries no marker.
-->

- [ ] The PR title carries `!` (`feat(scope)!: …`)
- [ ] The changeset is a **minor** bump (pre-1.0, minor is the breaking channel)
- [ ] An entry is added to `BREAKING-CHANGES.md` under `## Unreleased`
- [ ] A `BREAKING CHANGE:` footer below says what breaks and what to do instead
