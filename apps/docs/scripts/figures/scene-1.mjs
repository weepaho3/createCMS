// Scene 1: the book. One entry (root) and its blocks, laid out as a tray of nested compartments.
// The root is the tray; its children stand in the compartments in order; the gallery compartment holds its own three cards.
import * as k from "./kit/iso-kit.mjs";
import { writeScene } from "./lib.mjs";

const WIDTH = 640;
const HEIGHT = 400;

// Truth: the block tree of one entry, as block_versions rows would store it (type, properties, children).
const BLOCKS = {
  root: { type: "page", props: { title: "Pricing", __slug: "/pricing" }, children: ["hero", "text", "gallery"], label: "page" },
  hero: { type: "hero", props: { headline: "Plans for every team", image: "asset_7f2" }, children: [], label: "hero" },
  text: { type: "richText", props: { body: "…" }, children: [], label: "text" },
  gallery: { type: "gallery", props: { columns: 3 }, children: ["img1", "img2", "img3"], label: "gallery" },
  img1: { type: "image", props: { asset: "asset_a01", alt: "Starter" }, children: [], label: "image" },
  img2: { type: "image", props: { asset: "asset_a02", alt: "Team" }, children: [], label: "image" },
  img3: { type: "image", props: { asset: "asset_a03", alt: "Enterprise" }, children: [], label: "image" },
};
const ROOT = { id: "root_pricing", collection: "pages", slug: "/pricing" };

// World
const PLATE = { x: -150, y: -70, w: 300, d: 140, r: 8 };
const PLATE_H = 12;
const FOOT_H = 5;
const TRAY = { x: -118, y: -44, w: 236, d: 92, r: 3 }; // the root
const TRAY_Z = 0;
const RIM_H = 5;
const FLOOR_T = 2.4;
const COMP = [ // compartments for the root's children, in `children` order
  { id: "hero", x: -112, w: 66 },
  { id: "text", x: -40, w: 66 },
  { id: "gallery", x: 32, w: 80 },
];
const COMP_Y = -38;
const COMP_D = 80;
const CARD = { w: 3.2, d: 50, h: 30 };
const SUB = { ids: ["img1", "img2", "img3"], x0: 36, pitch: 24, d: 28, w: 3, h: 19 };


const P = k.fitProjection([...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-100, -40, CARD.h + 6], [100, -40, CARD.h + 6]], WIDTH, HEIGHT, { pad: 24, azimuth: 40 });
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

// The name plate on the tray's front rim: the roots row (collection and slug).
function namePlate() {
  const face = TRAY.y + TRAY.d;
  const plate = { x: -40, y: face, w: 80, d: 1.4, r: 0.3 };
  const out = [S(k.slabOf(plate, TRAY_Z + 0.6, 8, P, 2, 0.3), { tone: "hi", crease: "lo" })];
  out.push(k.faceTextSvg(k.sideMatrix([0, face + 1.4], TRAY_Z + 6.2, P, "left"), "pages · /pricing", { size: 4.6, tone: "lo", anchor: "middle" }));
  out.push(D([at([plate.x + 2.4, face + 1.4, TRAY_Z + 4.6]), at([plate.x + plate.w - 2.4, face + 1.4, TRAY_Z + 4.6])], { size: 0.5, tone: "lo" }));
  return `<g class="blk" data-block="root" data-x="0" data-y="${face}">${out.join("")}</g>`;
}

// The tray: the root block. Compartments for each child; the gallery compartment holds a sub-tray.
function tray() {
  const out = [];
  out.push(slab(TRAY, TRAY_Z, FLOOR_T, "mid", 4, 0.4));
  // Rim: four bars.
  const rim = (plan) => slab(plan, TRAY_Z + FLOOR_T, RIM_H, "mid", 3, 0.4);
  out.push(rim({ x: TRAY.x, y: TRAY.y, w: TRAY.w, d: 3, r: 1 }));
  out.push(rim({ x: TRAY.x, y: TRAY.y, w: 3, d: TRAY.d, r: 1 }));
  // Compartment dividers.
  for (const c of COMP.slice(1)) out.push(slab({ x: c.x - 4.2, y: COMP_Y, w: 2.4, d: COMP_D, r: 0.6 }, TRAY_Z + FLOOR_T, RIM_H - 1, "mid", 2, 0.3));
  // Slot outlines where the child cards stand.
  for (const c of COMP) out.push(L(k.planOutline({ x: c.x + c.w / 2 - 1.9, y: -24, w: 3.8, d: 48, r: 0.5 }, TRAY_Z + FLOOR_T, P, 3), { tone: "faint" }));
  // Sub-tray inside the gallery compartment, with three small slots.
  const g = COMP[2];
  const sub = { x: g.x + 2, y: 2, w: g.w - 4, d: 34, r: 1.5 };
  out.push(slab(sub, TRAY_Z + FLOOR_T, 1.6, "mid", 3, 0.3));
  out.push(slab({ x: sub.x, y: sub.y, w: sub.w, d: 2, r: 0.6 }, TRAY_Z + FLOOR_T + 1.6, 2.4, "mid", 2, 0.3));
  out.push(slab({ x: sub.x, y: sub.y, w: 2, d: sub.d, r: 0.6 }, TRAY_Z + FLOOR_T + 1.6, 2.4, "mid", 2, 0.3));
  SUB.ids.forEach((id, i) => out.push(L(k.planOutline({ x: SUB.x0 + i * SUB.pitch - 1.7, y: 6, w: 3.4, d: SUB.d, r: 0.4 }, TRAY_Z + FLOOR_T + 1.6, P, 3), { tone: "faint" })));
  out.push(D(k.corners(TRAY, 6).map(([x, y]) => at([x, y, TRAY_Z + FLOOR_T + RIM_H])), { size: 0.45 }));
  return out.join("");
}
function rimFront() {
  const rim = (plan) => slab(plan, TRAY_Z + FLOOR_T, RIM_H, "mid", 3, 0.4);
  return rim({ x: TRAY.x, y: TRAY.y + TRAY.d - 3, w: TRAY.w, d: 3, r: 1 }) + rim({ x: TRAY.x + TRAY.w - 3, y: TRAY.y, w: 3, d: TRAY.d, r: 1 });
}

// A block card standing in its slot: a page with a type band and rule lines, the number of rules = its property count.
function card(id, x, y, w, d, h, z) {
  const b = BLOCKS[id];
  const plan = { x: x - w / 2, y: y - d / 2, w, d, r: 0.5 };
  const n = Object.keys(b.props).filter((p) => !p.startsWith("__")).length;
  const rules = Array.from({ length: n }, (_, i) => z + h * 0.42 + i * 2.6);
  const inner = seams(plan, [z + h - 3.2], "lo") + seams(plan, rules);
  const out = [S(k.slabOf(plan, z, h, P, 3, 0.4), { tone: "hi", crease: "lo", inner })];
  const face = x + w / 2;
  out.push(D([at([face, y + d / 2 - 2, z + h - 1.6]), at([face, y - d / 2 + 2, z + h - 1.6])], { size: 0.4, tone: "lo" }));
  return `<g class="blk" data-block="${id}" data-x="${x}" data-y="${y}">${out.join("")}</g>`;
}
const cards = [];
for (const c of COMP) cards.push({ id: c.id, svg: card(c.id, c.x + c.w / 2, 0, CARD.w, CARD.d, CARD.h, TRAY_Z + FLOOR_T), x: c.x + c.w / 2, y: 0 });
SUB.ids.forEach((id, i) => cards.push({ id, svg: card(id, SUB.x0 + i * SUB.pitch, 20, SUB.w, SUB.d, SUB.h, TRAY_Z + FLOOR_T + 1.6), x: SUB.x0 + i * SUB.pitch, y: 20 }));
cards.sort((a, b) => depth(a.x, a.y) - depth(b.x, b.y));

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "A tray with a name plate reading pages /pricing on its front rim and three compartments, one card standing in each: hero, text and gallery. The gallery compartment holds a smaller tray with three image cards. The tray is the page block, the cards are its child blocks in order.",
  body: [plate(), tray(), ...cards.map((c) => c.svg), rimFront(), namePlate()],
});

const live = `
const BLOCKS = ${JSON.stringify(BLOCKS)};
const ROOT = ${JSON.stringify(ROOT)};
const ORDER = ["root", "hero", "text", "gallery", "img1", "img2", "img3"];
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const row = document.querySelector("[data-row]");
let current = null;
function describe(id) {
  const b = BLOCKS[id];
  const props = Object.entries(b.props).filter(([key]) => !key.startsWith("__")).map(([key, v]) => key + ": " + JSON.stringify(v)).join(", ");
  return { line: id === "root" ? "root block · type " + b.type + " · " + b.children.length + " children" : "block " + id + " · type " + b.type + (b.children.length ? " · " + b.children.length + " children" : ""),
           rows: [["block_id", id === "root" ? ROOT.id : "blk_" + id], ["type", b.type], ["properties", "{ " + props + " }"], ["children", "[" + b.children.map((c) => "blk_" + c).join(", ") + "]"], ["deleted", "false"]] };
}
function select(id) {
  current = id;
  svg.toggleAttribute("data-focus", !!id);
  svg.querySelectorAll(".blk").forEach((g) => g.toggleAttribute("data-on", g.dataset.block === id || (id === "root")));
  const text = id ? describe(id).line : "one entry · 7 block versions in its first commit";
  if (readout.textContent !== text) readout.textContent = text;
  if (row) row.innerHTML = id ? describe(id).rows.map(([key, v]) => "<div><b>" + key + "</b><span>" + v.replace(/</g, "&lt;") + "</span></div>").join("") : "<div><b>roots</b><span>id " + ROOT.id + " · collection " + ROOT.collection + " · slug " + ROOT.slug + "</span></div><div><b>block_versions</b><span>one row per block: hover a card</span></div>";
  stage.setAttribute("aria-valuetext", text);
}
svg.querySelectorAll(".blk").forEach((g) => g.addEventListener("pointerenter", () => select(g.dataset.block)));
svg.addEventListener("pointerleave", () => select(null));
stage.addEventListener("keydown", (e) => {
  const i = ORDER.indexOf(current);
  if (e.key === "ArrowRight") { select(ORDER[(i + 1) % ORDER.length]); e.preventDefault(); }
  if (e.key === "ArrowLeft") { select(ORDER[(i - 1 + ORDER.length) % ORDER.length]); e.preventDefault(); }
  if (e.key === "Escape") select(null);
});
let touring = !matchMedia("(prefers-reduced-motion: reduce)").matches, tourAt = -1, timer = 0;
const step = () => { if (!touring) return; tourAt = (tourAt + 1) % ORDER.length; select(ORDER[tourAt]); timer = setTimeout(step, 2200); };
timer = setTimeout(step, 1400);
["pointerenter", "pointerdown", "keydown", "focusin"].forEach((ev) => stage.addEventListener(ev, () => { touring = false; clearTimeout(timer); }));
select(null);
`;

const body =
  k.plateHtml({
    fig: "Fig 1",
    title: "The book",
    hint: "Hover a card or use ← →",
    readout: "one entry · 7 block versions in its first commit",
    keys: [
      { mark: "raised", label: "name plate: the roots row (collection, slug)" },
      { mark: "flat", label: "tray: the root block; compartments in children order" },
      { mark: "lit", label: "a card: one block, stored as a block_versions row" },
    ],
    caption: "",
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="The book: arrow keys walk through the blocks">${svg}</div>`,
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

writeScene("scene-1", { title: "How createCMS works · Fig 1 The book", body, script: live });
