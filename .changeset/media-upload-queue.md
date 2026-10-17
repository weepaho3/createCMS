---
'@createcms/core': minor
---

The client upload ledger is an upload queue shared by `upload()` and the
new `replace()`: at most four files and six connections, a 429 or S3
`SlowDown` halves the budget, PUTs without progress for 30 s time out and
retry, an expired signature is renewed once, and entries can be aborted,
retried, paused and resumed one by one. Progress carries a smoothed rate
and an ETA and is written to the store once per frame. The queue pauses
while offline and guards page unload only while bytes are moving. With
`dedupe: true`, files are hashed and checked against existing assets
first. `takeInterruptedUploads()` lists uploads that were unfinished when
the page was last hidden.
