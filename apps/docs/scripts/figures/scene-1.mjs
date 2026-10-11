// Scene 1: the glass planes. One entry lies on the camera's planes: each block is a cel, a group is a plane with its children on it.
import * as M from './camera-parts.mjs';
import { writeScene } from './lib.mjs';

const { k } = M;
const WIDTH = 640;
const HEIGHT = 420;

// Truth: the block tree as block_versions rows would store it.
const BLOCKS = {
  root: {
    type: 'page',
    props: { title: 'Pricing', __slug: '/pricing' },
    children: ['hero', 'text', 'gallery'],
  },
  hero: {
    type: 'hero',
    props: { headline: 'Plans for every team', image: 'asset_7f2' },
    children: [],
  },
  text: { type: 'richText', props: { body: '…' }, children: [] },
  gallery: {
    type: 'gallery',
    props: { columns: 3 },
    children: ['img1', 'img2', 'img3'],
  },
  img1: {
    type: 'image',
    props: { asset: 'asset_a01', alt: 'Starter' },
    children: [],
  },
  img2: {
    type: 'image',
    props: { asset: 'asset_a02', alt: 'Team' },
    children: [],
  },
  img3: {
    type: 'image',
    props: { asset: 'asset_a03', alt: 'Enterprise' },
    children: [],
  },
};
const ROOT = { id: 'root_pricing', collection: 'pages', slug: '/pricing' };
const ORDER = ['root', 'hero', 'text', 'gallery', 'img1', 'img2', 'img3'];

// Fit the planes, the column segment that carries them and the lens above.
const zLow = M.PLANE_Z[0] - 14;
const zHigh = M.CAMERA_Z - 10;
const P = k.fitProjection(
  [
    ...k.boxCorners(M.FRAME, zLow, M.PLANE_Z[2] + 6),
    [M.COLUMN[0] - 8, M.COLUMN[1] - 8, zLow],
    [M.COLUMN[0], M.COLUMN[1], zHigh],
    [M.LENS[0] + 8, M.LENS[1] + 8, zHigh],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 42 },
);
const m = M.makeMachine(P);

// The column is cut at both ends of this view; the lens hangs in from above.
const columnCut =
  m.cyl(
    M.COLUMN[0],
    M.COLUMN[1],
    M.COLUMN_R,
    zLow,
    zHigh - zLow,
    'mid',
    28,
    'none',
  ) +
  m.L(
    [44, 54, 78, 88, 112, 122]
      .map((z) => k.sideArc(M.COLUMN[0], M.COLUMN[1], M.COLUMN_R, z, P, 18))
      .join(''),
    { tone: 'faint' },
  );
const lens =
  m.cyl(M.LENS[0], M.LENS[1], 7.5, M.CAMERA_Z - 12, 3, 'mid', 28) +
  m.L(k.ring(M.LENS[0], M.LENS[1], 5, M.CAMERA_Z - 12, P, 24), { tone: 'lo' }) +
  m.cyl(M.LENS[0], M.LENS[1], 6, M.CAMERA_Z - 9, 9, 'hi', 28, 'lo');

// Groups: the gallery plane's frame belongs to the gallery block; the root is every plane.
const kindOf = (id) =>
  id === 'hero' ? 'hero' : id === 'text' ? 'text' : 'image';
const planes = [0, 1, 2].map((level) => {
  const owner = level === 2 ? 'gallery' : null;
  const cels = Object.entries(M.CELS)
    .filter(([, c]) => c.plane === level)
    .map(([id, c]) => m.cel(id, c, kindOf(id)))
    .join('');
  const frame = owner
    ? `<g class="blk" data-block="${owner}">${m.plane(level)}</g>`
    : m.plane(level);
  const front = owner
    ? `<g class="blk" data-block="${owner}">${m.planeFront(level)}</g>`
    : m.planeFront(level);
  return frame + cels + front;
});

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "Close-up of the camera's three glass planes on their column, with the lens above. On the bottom plane lies one large cel, the hero. On the middle plane a smaller cel with lines of text. On the top plane three small image cels side by side: the gallery, whose children lie on its plane.",
  body: [columnCut, ...planes, lens],
});

const live = `
const BLOCKS = ${JSON.stringify(BLOCKS)};
const ROOT = ${JSON.stringify(ROOT)};
const ORDER = ${JSON.stringify(ORDER)};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const row = document.querySelector("[data-row]");
let current = null;
const idOf = (id) => (id === "root" ? ROOT.id : "blk_" + id);
const parentOf = (id) => Object.keys(BLOCKS).find((p) => BLOCKS[p].children.includes(id));
const PLANE = { hero: "bottom plane", text: "middle plane", gallery: "top plane", img1: "top plane", img2: "top plane", img3: "top plane", root: "all three planes" };
function describe(id) {
  const b = BLOCKS[id];
  const props = Object.entries(b.props).filter(([key]) => !key.startsWith("__")).map(([key, v]) => key + ": " + JSON.stringify(v)).join(", ");
  const line = idOf(id) + " · " + PLANE[id] + (b.children.length ? " · " + b.children.length + " children" : "") + (parentOf(id) ? " · in " + idOf(parentOf(id)) : "");
  return { line, rows: [["block_id", idOf(id)], ["type", b.type], ["properties", "{ " + props + " }"], ["children", "[" + b.children.map(idOf).join(", ") + "]"], ["deleted", "false"]] };
}
function select(id) {
  current = id;
  svg.toggleAttribute("data-focus", !!id);
  const lit = new Set(id === "root" ? ORDER : id ? [id, ...BLOCKS[id].children] : []);
  svg.querySelectorAll(".blk").forEach((g) => g.toggleAttribute("data-on", lit.has(g.dataset.block)));
  const text = id ? describe(id).line : "one entry on the planes · 7 blocks";
  if (readout.textContent !== text) readout.textContent = text;
  if (row) row.innerHTML = id ? describe(id).rows.map(([key, v]) => "<div><b>" + key + "</b><span>" + v.replace(/</g, "&lt;") + "</span></div>").join("") : "<div><b>roots</b><span>id " + ROOT.id + " · collection " + ROOT.collection + " · slug " + ROOT.slug + "</span></div><div><b>block_versions</b><span>one row per cel: hover one</span></div>";
  stage.setAttribute("aria-valuetext", text);
}
svg.querySelectorAll(".blk").forEach((g) => g.addEventListener("pointerenter", (e) => { e.stopPropagation(); select(g.dataset.block); }));
svg.addEventListener("pointerleave", () => select(null));
stage.addEventListener("keydown", (e) => {
  const i = ORDER.indexOf(current);
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { select(ORDER[(i + 1) % ORDER.length]); e.preventDefault(); }
  if (e.key === "ArrowLeft" || e.key === "ArrowUp") { select(ORDER[(i - 1 + ORDER.length) % ORDER.length]); e.preventDefault(); }
  if (e.key === "Escape") select(null);
});
let touring = !matchMedia("(prefers-reduced-motion: reduce)").matches, tourAt = -1, timer = 0;
const step = () => { if (!touring) return; tourAt = (tourAt + 1) % ORDER.length; select(ORDER[tourAt]); timer = setTimeout(step, 2000); };
timer = setTimeout(step, 1400);
["pointerenter", "pointerdown", "keydown", "focusin"].forEach((ev) => stage.addEventListener(ev, () => { touring = false; clearTimeout(timer); }));
select(null);
`;

const body =
  k.plateHtml({
    fig: 'Fig 1',
    title: 'The planes',
    hint: 'Hover a cel or use ← →',
    readout: 'one entry on the planes · 7 blocks',
    keys: [
      {
        mark: 'lit',
        label: 'a cel: one block, stored as a block_versions row',
      },
      {
        mark: 'raised',
        label: 'a plane that carries a group: its children lie on it, in order',
      },
    ],
    caption: '',
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="The planes: arrow keys walk through the blocks">${svg}</div>`,
  }) +
  `<div class="rows" data-row></div>
  <style>
    .iso-svg[data-focus] .blk:not([data-on]) { opacity: .3; transition: opacity .3s; }
    .blk { transition: opacity .3s; cursor: pointer; }
    .rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 10px 0 0; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--anatomy-hi); }
    .rows div { display: contents; }
    .rows b { font-weight: 600; opacity: .7; }
    .rows span { word-break: break-word; }
  </style>`;

writeScene('scene-1', {
  title: 'How createCMS works · Fig 1 The planes',
  body,
  script: live,
});
