---
'@createcms/core': patch
---

Release item mutations check draft status under a row lock inside their
transaction, and `duplicateBlock` accepts `expectedHeadCommitId`
(`HEAD_MISMATCH` when the branch has advanced), like the other mutations.
