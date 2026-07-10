---
'@createcms/core': patch
---

fix(merge): stop dropping one-side-added blocks from merged snapshots (data loss)

`buildMergedSnapshot`'s delete-vs-edit exclusion treated "absent from the other side" as "deleted by the other side" — but a block with no live version at the common ancestor is simply NEW on whichever side carries it. On any merge where the target had diverged (the real three-way path), this silently dropped blocks that were added after the branch point on either side: content vanished from the merged tree with no conflict and no error. The exclusion is now gated on a live base version, so one-side additions always survive; genuine delete-vs-edit cases (block existed at the ancestor) still resolve exactly as before. Fast-forward and forced-merge-on-undiverged-target paths were never affected.
