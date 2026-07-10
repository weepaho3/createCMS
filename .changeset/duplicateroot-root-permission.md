---
'@createcms/core': patch
---

fix(blocks): guard duplicateRoot as root:create, not block:create

`duplicateRoot` mints a NEW top-level root (forced root mode), the same
privileged act `createRoot` guards as `permissionResource: 'root'`, but it was
labeled `permissionResource: 'block'`. A consumer granting `block:create` while
denying `root:create` could create roots through duplication. The metadata now
reads `root`. BREAKING for any authMiddleware policy that mapped
`duplicateRoot` under `block` — remap it to `root`.
