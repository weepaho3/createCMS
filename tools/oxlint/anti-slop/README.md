# anti-slop (Oxlint JS plugin)

Local Oxlint plugin, adapted from the anti-slop plugin bundled with the
`install-anti-slop` skill and trimmed to the rules this repository enforces.
Registered in `/.oxlintrc.json` under `jsPlugins` as `anti-slop`; the rule
severities and the test-file override live there as well.

| Rule | Rejects |
| --- | --- |
| `no-chained-type-assertions` | `x as unknown as T` chains (off in tests and `*.type-check.ts`) |
| `no-conditional-empty-object-spread` | `...(cond ? { k } : {})` to omit a key |
| `no-object-parameters` | parameters typed `object` |
| `no-reflect-apply`, `no-reflect-get` | `Reflect.apply` / `Reflect.get` |
| `no-shape-in-symbol-names` | the substring "shape" in any symbol name |
| `no-unknown-type-aliases` | aliases that resolve to `unknown` |
| `no-widen-then-assert` | a `const` widened on declaration and asserted back later |

The plugin imports `@oxlint/plugins`, which must match the installed `oxlint`
version exactly (both are pinned in the root `package.json`). The directory is
excluded from `oxlint` and `oxfmt` because it keeps the upstream formatting.
