---
'@createcms/react': patch
---

The editor's shortcuts pause inside an open modal (`aria-modal="true"`) and
inside a menu, as WAI-ARIA asks: Mod+Z in a dialog's input no longer undoes
the page behind it, and Alt+Arrow on a menu item no longer moves a block.
