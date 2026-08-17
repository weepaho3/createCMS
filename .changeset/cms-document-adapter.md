---
'@createcms/react': patch
---

`useCmsDocument` loads and saves a collection document through a
duck-typed createcms client, tracks the branch head, and exposes a
canvas `resolve` map from the references sidecar.
