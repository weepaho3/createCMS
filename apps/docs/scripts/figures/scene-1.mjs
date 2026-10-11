// Scene 1: the book. One entry (root) as an open book: the cover carries the roots row, the page stack is the block tree.
// Chapters are nested blocks (register tabs), pages are the leaf blocks under them, in `children` order.
import * as k from "./kit/iso-kit.mjs";
import { writeScene } from "./lib.mjs";

const WIDTH = 640;
const HEIGHT = 400;

// Truth: the block tree of one entry, as block_versions rows would store it (type, properties, children).
const BLOCKS = {
  root: { type: "book", props: { title: "Handbook", __slug: "/handbook" }, children: ["ch1", "ch2", "ch3"] },
  ch1: { type: "chapter", props: { title: "Getting started" }, children: ["p11", "p12"] },
  p11: { type: "page", props: { title: "Install", body: "…" }, children: [] },
  p12: { type: "page", props: { title: "First entry", body: "…" }, children: [] },
  ch2: { type: "chapter", props: { title: "Writing" }, children: ["p21", "p22", "p23"] },
  p21: { type: "page", props: { title: "Blocks", body: "…" }, children: [] },
  p22: { type: "page", props: { title: "Branches", body: "…" }, children: [] },
  p23: { type: "page", props: { title: "Publishing", body: "…" }, children: [] },
  ch3: { type: "chapter", props: { title: "Reference" }, children: ["p31"] },
  p31: { type: "page", props: { title: "API", body: "…" }, children: [] },
};
const ROOT = { id: "root_handbook", collection: "books", slug: "/handbook" };
// Reading order, top of the stack first.
const ORDER = ["ch1", "p11", "p12", "ch2", "p21", "p22", "p23", "ch3", "p31"];

// World
const PLATE = { x: -150, y: -70, w: 300, d: 140, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;
const BOARD = { x: -124, y: -58, w: 248, d: 116, r: 2 }; // the back board of the open book
const BOARD_H = 2;
const COVER = { x: -120, y: -54, w: 114, d: 108, r: 1.5 }; // the front cover, opened to the left
const COVER_H = 1.4;
const PAGE = { x: 8, w: 106, d: 100, h: 0.7 }; // one page; the stack fans toward the viewer
const STEP = 5.2; // how far each deeper page shows beyond the one above it
const CHAPTER_H = 1.3;
const TAB = { w: 11, d: 15 }; // register tab on the right edge of a chapter divider
const STACK_Y0 = -54; // y of the top page's far edge
const STACK_Z0 = BOARD_H;

const P = k.fitProjection([...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [0, 0, 14]], WIDTH, HEIGHT, { pad: 24, azimuth: 40 });
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const depth = (x, y) => k.depthOf([x, y, 0], P);
const slab = (plan, z, h, tone = "mid", steps = 3, bevel = 0.4, extra = {}) => S(k.slabOf(plan, z, h, P, steps, bevel), { tone, ...extra });
const seams = (plan, zs, tone = "faint", steps = 3) => zs.map((z) => L(k.sideSeam(plan, z, P, steps), { tone })).join("");

function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of k.corners(PLATE, 22).sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(slab(PLATE, -PLATE_H, PLATE_H, "mid", 8, 1.6));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

// Back board, spine and the opened front cover with the name plate: the roots row.
function cover() {
  const out = [slab(BOARD, 0, BOARD_H, "lo", 3, 0.3)];
  out.push(slab({ x: -3, y: BOARD.y, w: 6, d: BOARD.d, r: 1 }, BOARD_H, 1.2, "lo", 3, 0.2));
  out.push(L([BOARD.y + 6, BOARD.y + BOARD.d - 6].map((y) => k.lineOnTop([-2.2, y], [2.2, y], BOARD_H + 1.2, P)).join(""), { tone: "faint", free: true }));
  const cov = slab(COVER, BOARD_H, COVER_H, "mid", 4, 0.4);
  const top = BOARD_H + COVER_H;
  const plate = { x: COVER.x + 18, y: COVER.y + 36, w: 78, d: 30, r: 2 };
  const name = [];
  name.push(slab(plate, top, 0.8, "hi", 4, 0.2));
  name.push(L(k.planOutline(k.insetPlan(plate, 2.2), top + 0.8, P, 4), { tone: "lo" }));
  name.push(k.faceTextSvg(k.topMatrix([plate.x + plate.w / 2, plate.y + 12], top + 0.8, P, "x"), "books", { size: 5.2, tone: "hi", anchor: "middle" }));
  name.push(k.faceTextSvg(k.topMatrix([plate.x + plate.w / 2, plate.y + 22], top + 0.8, P, "x"), "/handbook", { size: 4.2, tone: "lo", anchor: "middle" }));
  name.push(D(k.corners(plate, 3).map(([x, y]) => at([x, y, top + 0.8])), { size: 0.45, tone: "lo" }));
  // Hinge line where the cover meets the spine.
  out.push(`<g class="blk" data-block="root">${cov}${name.join("")}</g>`);
  return out.join("");
}

// The page stack: pages and chapter dividers from the bottom up, each one a little further toward the viewer.
function stack() {
  const items = [];
  let z = STACK_Z0;
  // Bottom of the stack is the last item in reading order.
  const list = [...ORDER].reverse();
  const depthIndex = (id) => ORDER.indexOf(id); // 0 = top
  for (const id of list) {
    const isChapter = BLOCKS[id].type === "chapter";
    const i = depthIndex(id);
    const y = STACK_Y0 + i * STEP;
    const h = isChapter ? CHAPTER_H : PAGE.h;
    const plan = { x: PAGE.x, y, w: PAGE.w, d: PAGE.d, r: 0.6 };
    const out = [slab(plan, z, h, isChapter ? "hi" : "mid", 3, 0.25, { crease: isChapter ? "lo" : "faint" })];
    // A rule line along the visible strip of every page: its title line.
    out.push(L(k.lineOnTop([PAGE.x + 10, y + PAGE.d - 2.4], [PAGE.x + PAGE.w - 10, y + PAGE.d - 2.4], z + h, P), { tone: isChapter ? "hi" : "lo", free: true }));
    if (isChapter) {
      // Register tab on the right edge, staggered down the edge for each chapter.
      const chapters = ORDER.filter((c) => BLOCKS[c].type === "chapter");
      const slot = chapters.indexOf(id);
      const ty = y + 8 + slot * (TAB.d + 6);
      const tab = { x: PAGE.x + PAGE.w - 1, y: ty, w: TAB.w + 1, d: TAB.d, r: 1.2 };
      out.push(slab(tab, z, h, "hi", 3, 0.25, { crease: "lo" }));
      out.push(L(k.planOutline({ x: tab.x + 3, y: ty + 2.5, w: TAB.w - 4, d: TAB.d - 5, r: 0.8 }, z + h, P, 3), { tone: "lo" }));
    }
    items.push(`<g class="blk" data-block="${id}">${out.join("")}</g>`);
    z += h;
  }
  return items.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "An open book lies on a plate. The front cover on the left carries a name plate reading books /handbook. On the right the pages are stacked, each showing a strip of its near edge. Three thicker chapter dividers sit in the stack with register tabs on the right edge; the pages under each tab belong to that chapter.",
  body: [plate(), cover(), stack()],
});

const live = `
const BLOCKS = ${JSON.stringify(BLOCKS)};
const ROOT = ${JSON.stringify(ROOT)};
const ORDER = ${JSON.stringify(["root", ...ORDER])};
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const row = document.querySelector("[data-row]");
let current = null;
const idOf = (id) => (id === "root" ? ROOT.id : "blk_" + id);
const parentOf = (id) => Object.keys(BLOCKS).find((p) => BLOCKS[p].children.includes(id));
function describe(id) {
  const b = BLOCKS[id];
  const props = Object.entries(b.props).filter(([key]) => !key.startsWith("__")).map(([key, v]) => key + ": " + JSON.stringify(v)).join(", ");
  const what = b.type === "book" ? "root block" : b.type === "chapter" ? "chapter, a nested block" : "page, a leaf block";
  const line = idOf(id) + " · " + what + (b.children.length ? " · " + b.children.length + " children" : "") + (parentOf(id) ? " · in " + idOf(parentOf(id)) : "");
  return { line, rows: [["block_id", idOf(id)], ["type", b.type], ["properties", "{ " + props + " }"], ["children", "[" + b.children.map(idOf).join(", ") + "]"], ["deleted", "false"]] };
}
function select(id) {
  current = id;
  svg.toggleAttribute("data-focus", !!id);
  const lit = new Set(id ? [id, ...BLOCKS[id].children] : []);
  svg.querySelectorAll(".blk").forEach((g) => { g.toggleAttribute("data-on", lit.has(g.dataset.block)); g.toggleAttribute("data-pick", g.dataset.block === id); });
  const text = id ? describe(id).line : "one entry · 10 blocks · 3 chapters, 6 pages";
  if (readout.textContent !== text) readout.textContent = text;
  if (row) row.innerHTML = id ? describe(id).rows.map(([key, v]) => "<div><b>" + key + "</b><span>" + v.replace(/</g, "&lt;") + "</span></div>").join("") : "<div><b>roots</b><span>id " + ROOT.id + " · collection " + ROOT.collection + " · slug " + ROOT.slug + "</span></div><div><b>block_versions</b><span>one row per block: hover the cover, a tab or a page</span></div>";
  stage.setAttribute("aria-valuetext", text);
}
svg.querySelectorAll(".blk").forEach((g) => g.addEventListener("pointerenter", () => select(g.dataset.block)));
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
    fig: "Fig 1",
    title: "The book",
    hint: "Hover or use ↑ ↓",
    readout: "one entry · 10 blocks · 3 chapters, 6 pages",
    keys: [
      { mark: "raised", label: "cover with name plate: the entry, a roots row" },
      { mark: "lit", label: "chapter divider with tab: a nested block whose children are its pages" },
      { mark: "flat", label: "page: a leaf block, one block_versions row" },
    ],
    caption: "",
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="The book: arrow keys walk through cover, chapters and pages">${svg}</div>`,
  }) +
  `<div class="rows" data-row></div>
  <style>
    .iso-svg[data-focus] .blk:not([data-on]) { opacity: .3; transition: opacity .3s; }
    .blk { transition: opacity .3s; cursor: pointer; }
    .blk[data-pick] .iso-edge { stroke-width: 1.1; }
    .rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin: 10px 0 0; font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--anatomy-hi); }
    .rows div { display: contents; }
    .rows b { font-weight: 600; opacity: .7; }
    .rows span { word-break: break-word; }
  </style>`;

writeScene("scene-1", { title: "How createCMS works · Fig 1 The book", body, script: live });
