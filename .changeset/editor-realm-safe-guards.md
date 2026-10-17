---
'@createcms/react': patch
---

DOM checks in the editor and canvas no longer use `instanceof HTMLElement` or
`instanceof Node`, which are false for nodes in a same-origin iframe. Focus
after a drop, the single-child row flow check of the insert geometry, the
inline text glass and `useEditorKeyboard` now work for blocks rendered into an
iframe document.
