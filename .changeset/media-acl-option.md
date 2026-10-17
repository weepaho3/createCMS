---
'@createcms/core': patch
---

New `media.acl` option. `acl: false` sends no `x-amz-acl` header, which AWS
buckets with Object Ownership "Bucket owner enforced" (the default for new
buckets) require. The default stays `'public-read'`.
