# use-render

Internal polymorphic-render helper (`useRender`, `mergeProps`) that powers the
`render` prop on `@createcms/react` primitives. It lets a component render as
a custom element while merging the primitive's props, refs, and state
attributes onto it.

## Attribution

This code is a local copy of [shadcn/ui](https://github.com/shadcn-ui/ui)'s
`useRender` implementation (`packages/react/src/use-render`), MIT licensed,
© shadcn — which is itself adapted from [Base UI](https://github.com/mui/base-ui)'s
`useRender` (`@base-ui/react/use-render`), MIT licensed, © MUI. We keep a
local copy so the primitives carry no runtime dependency on either project.

See `THIRD_PARTY_NOTICES` at the package root for the full license text.

If Base UI publishes `useRender` as an independent, standalone package, we
will switch to it and remove this copy.
