---
'@createcms/react': minor
---

`Media.Image` and `Media.Picture` render an asset with a `srcset` of its
existing renditions only, the ThumbHash or colour placeholder, the focal
point as `object-position` and `data-provenance`; `useAssetImage` returns
the same data. `@createcms/react/media/image` offers the helpers without a
client boundary (`getAssetImage`, `variantUrl`, `buildSrcSet`,
`createImageLoader`), and `@createcms/react/media/next-loader` is a Next.js
`loaderFile` that snaps widths to the rendition ladder. Upload types mirror
rendition entries, and `Media.UploadList` lists parents only.
