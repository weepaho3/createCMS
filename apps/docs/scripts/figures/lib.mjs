// Shared page wrapper for the "How createCMS works" figures.
// Each figure is a standalone page under public/how-it-works, embedded by the <Scene> MDX component in an iframe.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as k from './kit/iso-kit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, '..', '..', 'public', 'how-it-works');

/** The kit source inlined into a page so live code can call its functions. */
export function kitScript() {
  return readFileSync(join(HERE, 'kit', 'iso-kit.mjs'), 'utf8').replace(
    /^export /gm,
    '',
  );
}

// The theme follows the embedding page: `?theme=dark|light` on load, then `postMessage({ theme })` updates.
const THEME_SCRIPT = `
(() => {
  let theme = new URLSearchParams(location.search).get("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const apply = (t) => { if (t === "dark" || t === "light") { theme = t; if (document.body) document.body.dataset.theme = t; } };
  document.addEventListener("DOMContentLoaded", () => apply(theme));
  addEventListener("message", (e) => { if (e.data && typeof e.data === "object" && e.data.theme) apply(e.data.theme); });
})();
`;

const EMBED_CSS = `
html, body { margin: 0; background: transparent; }
.iso-page { padding: 0; max-width: none; }
.iso-figure { margin: 0; }
`;

export function writeScene(name, { title, body, script }) {
  mkdirSync(OUT, { recursive: true });
  let html = k.pageHtml({
    title,
    theme: 'light',
    body,
    script: kitScript() + script,
    width: 720,
  });
  html = html
    .replace('</style>', EMBED_CSS + '</style>')
    .replace('</head>', `<script>${THEME_SCRIPT}</script></head>`);
  const file = join(OUT, `${name}.html`);
  writeFileSync(file, html);
  console.log('wrote', file);
}
