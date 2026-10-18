---
'@createcms/react': patch
---

Canvas drags start by pointer type (a still 250 ms press on touch, the
first movement for a mouse on a drag handle, 5 px otherwise), find the
block under the pointer through the browser's hit test, drop beside a tall
container from its edge band, hold the target against jitter, and
auto-scroll nested scrollers at a frame-rate independent speed. Dragging a
block of a multi-selection moves every selected block in order as one undo
step, and a drag whose block someone else removed ends with an
announcement.
