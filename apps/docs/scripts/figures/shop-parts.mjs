// Parts of the bookbinder's shop, shared by the "How createCMS works" scenes.
// Built with the Anatomy isometric kit (scripts/figures/kit, MIT).
import * as k from "./kit/iso-kit.mjs";
export const WIDTH = 640;
export const HEIGHT = 440;

// ---------- Building ----------
const FLOOR = { x: -150, y: -95, w: 300, d: 190, r: 2 };
const FLOOR_Z = 4; // floor top
const WALL_H = 70;
const BACK = { x: -154, y: -99, w: 308, d: 4, r: 0.5 }; // inner face at y = -95
const LEFT = { x: -154, y: -99, w: 4, d: 194, r: 0.5 }; // inner face at x = -150
const WALK = { x: -162, y: 97, w: 324, d: 20, r: 2 };

const P = k.fitProjection(
  [...k.boxCorners(FLOOR, -6, FLOOR_Z), [-154, -99, FLOOR_Z + WALL_H], [154, -99, FLOOR_Z + WALL_H], [-154, 95, FLOOR_Z + WALL_H], [-72, 94, 46], [112, 94, 56], [162, 117, 0]],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 38 },
);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);
const riseClip = (plan, z) => k.slabOf(plan, z, 80, P, 3).fill;
const cyl = (x, y, r, z, h, tone = "mid", steps = 20, crease) => S(k.cylinder(x, y, r, z, h, P, steps), { tone, crease });
const slab = (plan, z, h, tone = "mid", steps = 3, bevel = 0.4, extra = {}) => S(k.slabOf(plan, z, h, P, steps, bevel), { tone, ...extra });
const seams = (plan, zs, tone = "faint", steps = 3) => zs.map((z) => L(k.sideSeam(plan, z, P, steps), { tone })).join("");
const legs = (plan, inset, r, z, h, tone = "mid") => k.corners(plan, inset).sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1])).map(([x, y]) => cyl(x, y, r, z, h, tone, 16)).join("");

function building() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: FLOOR.x - 8, y: FLOOR.y - 6, w: FLOOR.w + 16, d: FLOOR.d + 28, r: 4 }, -6, 6, P)}"/>`);
  // Walls first: they are the farthest things.
  const backInner = seams(BACK, [FLOOR_Z + 6, FLOOR_Z + 6.8], "lo") + seams(BACK, [FLOOR_Z + 48], "faint");
  out.push(S(k.slabOf(BACK, 0, FLOOR_Z + WALL_H, P, 2), { tone: "lo", crease: "lo", inner: backInner }));
  out.push(S(k.slabOf(LEFT, 0, FLOOR_Z + WALL_H, P, 2), { tone: "lo", crease: "lo", inner: seams(LEFT, [FLOOR_Z + 6, FLOOR_Z + 6.8], "lo") + seams(LEFT, [FLOOR_Z + 48], "faint") }));
  // Wall clock on the back wall, and a wall shelf with four books on the left wall.
  const CLOCK = [30, -95, 56];
  out.push(L(k.sideRing(CLOCK, 6.5, "y", P, 32) + k.sideRing(CLOCK, 5.4, "y", P, 32), { tone: "lo" }));
  out.push(L(k.segment(CLOCK, [CLOCK[0] + 0.3, -95, 60.4], P) + k.segment(CLOCK, [33.6, -95, 57.2], P), { tone: "hi", free: true }));
  out.push(D([at(CLOCK)], { size: 0.5, tone: "hi" }));
  const SIGN = { x: -10, y: -95, w: 68, d: 1.4, r: 0.3 };
  out.push(S(k.slabOf(SIGN, FLOOR_Z + 62, 9, P, 2, 0.3), { tone: "hi", crease: "lo", inner: seams(SIGN, [FLOOR_Z + 63.2, FLOOR_Z + 69.8]) }));
  out.push(k.faceTextSvg(k.sideMatrix([SIGN.x + SIGN.w / 2, SIGN.y + SIGN.d], FLOOR_Z + 65, P, "left"), "BUCHBINDEREI", { size: 3.6, tone: "lo", anchor: "middle" }));
  const SHELF = { x: -150, y: -74, w: 14, d: 44, r: 0.4 };
  out.push(slab(SHELF, 46, 2, "mid", 2, 0.3));
  out.push(cyl(-146, -70, 1, 36, 10, "mid", 10, "none"), cyl(-146, -34, 1, 36, 10, "mid", 10, "none"));
  for (const [y, d, h] of [[-71, 5, 14], [-65, 4, 12], [-60, 6, 15], [-53, 3.5, 11], [-49, 5, 13]]) out.push(slab({ x: -149, y, w: 11, d, r: 0.3 }, 48, h, "hi", 2, 0.3));
  // Street and floor.
  out.push(slab(WALK, -2, 2, "lo", 3, 0.6));
  out.push(L([-120, -80, -40, 0, 40, 80, 120].map((x) => k.segment([x, WALK.y + 1, 0], [x, WALK.y + WALK.d - 1, 0], P)).join(""), { tone: "faint", free: true }));
  out.push(slab(FLOOR, 0, FLOOR_Z, "lo", 3, 0.8));
  const tiles = [];
  for (let x = -130; x < 150; x += 20) tiles.push(k.segment([x, FLOOR.y, FLOOR_Z], [x, FLOOR.y + FLOOR.d, FLOOR_Z], P));
  for (let y = -75; y < 95; y += 20) tiles.push(k.segment([FLOOR.x, y, FLOOR_Z], [FLOOR.x + FLOOR.w, y, FLOOR_Z], P));
  out.push(L(tiles.join(""), { tone: "faint" }));
  // Rug in front of the counter.
  out.push(L(k.planOutline({ x: -70, y: 12, w: 110, d: 20, r: 1 }, FLOOR_Z, P, 3) + k.planOutline({ x: -67, y: 15, w: 104, d: 14, r: 0.6 }, FLOOR_Z, P, 3), { tone: "lo" }));
  return out.join("");
}

// ---------- Bücherwand: a bookcase of finished books along the back wall ----------
function bookcase() {
  const BC = { x: -14, y: -94, w: 72, d: 15, r: 0.6 };
  const out = [slab(BC, FLOOR_Z, 3, "mid", 2, 0.4)];
  for (const x of [BC.x, BC.x + BC.w - 2.4]) out.push(slab({ x, y: BC.y, w: 2.4, d: BC.d, r: 0.3 }, FLOOR_Z + 3, 52, "mid", 2, 0.3));
  const shelves = [FLOOR_Z + 3, FLOOR_Z + 20, FLOOR_Z + 37];
  const heights = [11, 13, 10, 14, 12, 9, 13, 11, 12, 14, 10, 12, 11, 13];
  const widths = [3, 2.2, 3.6, 2.6, 3, 2.4, 3.4, 2.8, 2.2, 3.2, 2.6, 3, 2.4, 3.4];
  shelves.forEach((z, row) => {
    out.push(slab({ x: BC.x + 2.4, y: BC.y + 1, w: BC.w - 4.8, d: BC.d - 1, r: 0.3 }, z, 1.6, "mid", 2, 0.2));
    let x = BC.x + 3.6 + row * 1.3;
    for (let i = 0; i < 14 && x + widths[(i + row) % 14] < BC.x + BC.w - 3.6; i++) {
      const w = widths[(i + row * 3) % 14];
      const h = heights[(i + row * 5) % 14];
      out.push(slab({ x, y: BC.y + 2.5, w, d: 11, r: 0.3 }, z + 1.6, h, i % 3 === 1 ? "mid" : "hi", 2, 0.2, { crease: "lo" }));
      x += w + 0.5;
    }
  });
  out.push(slab({ x: BC.x - 1, y: BC.y - 1, w: BC.w + 2, d: BC.d + 2, r: 0.8 }, FLOOR_Z + 55, 2.4, "mid", 3, 0.4));
  return out.join("");
}

// ---------- Archivregal: the sheets (block_versions) ----------
const RACK = { x: -142, y: -94, w: 112, d: 24, r: 1 };
const RACK_Z = FLOOR_Z + 4;
const SLOT_PITCH = 16;
const sheetX = (i) => -131 + i * SLOT_PITCH;
const SHEET = { w: 1.6, d: 16, h: 20 };
const SHEET_Y = -82;
function rack() {
  const out = [];
  out.push(slab(RACK, FLOOR_Z, 4, "mid", 3, 0.5));
  out.push(seams(RACK, [FLOOR_Z + 1.2], "faint"));
  for (const x of [RACK.x, RACK.x + RACK.w - 3]) out.push(slab({ x, y: RACK.y, w: 3, d: RACK.d, r: 0.4 }, RACK_Z, 34, "mid", 2, 0.3));
  for (let i = 0; i < 5; i++) out.push(slab({ x: sheetX(i) + 7.4, y: RACK.y + 2, w: 1.2, d: 20, r: 0.3 }, RACK_Z, 22, "mid", 2, 0, { crease: "lo" }));
  for (let i = 0; i < 6; i++) out.push(L(k.planOutline({ x: sheetX(i) - 1.1, y: SHEET_Y - 8.3, w: 2.2, d: 16.6, r: 0.4 }, RACK_Z, P, 3), { tone: "faint" }));
  out.push(slab({ x: RACK.x - 1, y: RACK.y - 1, w: RACK.w + 2, d: RACK.d + 2, r: 1 }, RACK_Z + 34, 3, "mid", 3, 0.5));
  out.push(slab({ x: RACK.x - 2.5, y: RACK.y - 2.5, w: RACK.w + 5, d: RACK.d + 5, r: 1.2 }, RACK_Z + 37, 2, "mid", 3, 0.4));
  out.push(D(k.corners({ x: RACK.x - 1, y: RACK.y - 1, w: RACK.w + 2, d: RACK.d + 2 }, 3).map(([x, y]) => at([x, y, RACK_Z + 39])), { size: 0.45 }));
  return out.join("");
}
function sheetSvg(i, lane) {
  const plan = { x: sheetX(i) - SHEET.w / 2, y: SHEET_Y - SHEET.d / 2, w: SHEET.w, d: SHEET.d, r: 0.4 };
  const inner = seams(plan, [RACK_Z + 12 + lane * 2.4], "lo") + seams(plan, [RACK_Z + 3, RACK_Z + 4.6, RACK_Z + 6.2, RACK_Z + 7.8]);
  return S(k.slabOf(plan, RACK_Z, SHEET.h, P, 3, 0.3), { tone: "hi", crease: "lo", inner });
}
const sheetClip = (i) => riseClip({ x: sheetX(i) - SHEET.w / 2, y: SHEET_Y - SHEET.d / 2, w: SHEET.w, d: SHEET.d, r: 0.4 }, RACK_Z);

// ---------- Druckpresse on a bench against the left wall ----------
const BENCH = { x: -148, y: -40, w: 36, d: 44, r: 1 };
const BENCH_Z = 24;
const PRESS_C = [-130, -18]; // centre of the press bed
const BED_Z = BENCH_Z + 3;
const PLATEN_Z = BED_Z + 9;
function press() {
  const out = [];
  out.push(legs(BENCH, 4, 1.8, FLOOR_Z, BENCH_Z - FLOOR_Z));
  out.push(slab({ x: BENCH.x + 3, y: BENCH.y + 20, w: BENCH.w - 6, d: 3, r: 0.4 }, FLOOR_Z + 8, 2, "mid", 2, 0.2));
  out.push(slab(BENCH, BENCH_Z, 3, "mid", 3, 0.5, { inner: seams(BENCH, [BENCH_Z + 1.4]) }));
  const bed = { x: PRESS_C[0] - 12, y: PRESS_C[1] - 11, w: 24, d: 22, r: 1 };
  out.push(slab(bed, BENCH_Z + 3, 3, "mid", 3, 0.5));
  out.push(D(k.corners(bed, 2.2).map(([x, y]) => at([x, y, BED_Z + 3])), { size: 0.45 }));
  // Blank sheets waiting on the bed.
  for (let i = 0; i < 3; i++) out.push(slab({ x: PRESS_C[0] - 7 + i * 0.3, y: PRESS_C[1] - 7 + i * 0.2, w: 14, d: 14, r: 0.3 }, BED_Z + 3 + i * 0.5, 0.5, "hi", 2, 0, { crease: "none" }));
  // Far column (the near one is drawn in front of the platen).
  out.push(cyl(PRESS_C[0], PRESS_C[1] - 9, 1.8, BED_Z + 3, 24, "mid", 18, "none"));
  out.push(L([BED_Z + 10, BED_Z + 20].map((z) => k.sideArc(PRESS_C[0], PRESS_C[1] - 9, 1.8, z, P, 12)).join(""), { tone: "faint" }));
  // Ink pot and a stack of finished sheets beside the press.
  out.push(cyl(BENCH.x + 6, BENCH.y + 36, 2.4, BENCH_Z + 3, 3, "mid", 16));
  out.push(L(k.ring(BENCH.x + 6, BENCH.y + 36, 1.6, BENCH_Z + 6, P, 14), { tone: "lo" }));
  out.push(slab({ x: BENCH.x + 20, y: BENCH.y + 32, w: 12, d: 9, r: 0.3 }, BENCH_Z + 3, 1.6, "hi", 2, 0, { crease: "lo" }));
  return out.join("");
}
function pressTop() {
  const out = [];
  out.push(cyl(PRESS_C[0], PRESS_C[1] + 9, 1.8, BED_Z + 3, 24, "mid", 18, "none"));
  out.push(L([BED_Z + 10, BED_Z + 20].map((z) => k.sideArc(PRESS_C[0], PRESS_C[1] + 9, 1.8, z, P, 12)).join(""), { tone: "faint" }));
  const bar = { x: PRESS_C[0] - 4, y: PRESS_C[1] - 11, w: 8, d: 22, r: 1 };
  out.push(slab(bar, BED_Z + 27, 4, "mid", 3, 0.5));
  out.push(cyl(PRESS_C[0], PRESS_C[1], 3.2, BED_Z + 31, 4, "mid", 24));
  out.push(L(k.knurl(PRESS_C[0], PRESS_C[1], 3.2, BED_Z + 31, BED_Z + 35, 24, P), { tone: "lo" }));
  out.push(L(k.lineOnTop(PRESS_C, [PRESS_C[0] + 3.2, PRESS_C[1]], BED_Z + 35, P), { tone: "hi" }));
  out.push(D([at([PRESS_C[0], PRESS_C[1], BED_Z + 35])], { size: 0.5, tone: "hi" }));
  // Lever arm out of the knob.
  out.push(slab({ x: PRESS_C[0] + 2.6, y: PRESS_C[1] - 1, w: 14, d: 2, r: 0.6 }, BED_Z + 32, 1.6, "mid", 2, 0.2));
  out.push(cyl(PRESS_C[0] + 16, PRESS_C[1], 1.6, BED_Z + 31.4, 2.8, "mid", 12));
  return out.join("");
}
function platenSvg() {
  const plan = { x: PRESS_C[0] - 8, y: PRESS_C[1] - 8, w: 16, d: 16, r: 0.8 };
  const out = [slab(plan, PLATEN_Z, 3.5, "hi", 3, 0.5, { crease: "lo" })];
  out.push(cyl(PRESS_C[0], PRESS_C[1], 2.2, PLATEN_Z + 3.5, 24 - 9 - 3.5, "mid", 16, "none"));
  return out.join("");
}

// ---------- Ladentheke with the Kartei (commits) and the Lesezeichen (branches) ----------
const COUNTER = { x: -100, y: -18, w: 152, d: 24, r: 1.5 };
const COUNTER_Z = FLOOR_Z + 22;
const TOP_Z = COUNTER_Z + 3;
const KARTEI = { x: -82, y: -16.5, w: 124, d: 22, r: 1.5 };
const CARD_PITCH = 22;
const cardX = (i) => -67 + i * CARD_PITCH;
const CARD_Y = -5.5;
const CARD = { w: 3.2, d: 16, h: 15 };
const CARD_Z = TOP_Z + 2 + 3;
const CARD_TOP = CARD_Z + CARD.h;
const CLIP = { w: 6, d: 6, z: CARD_TOP - 2.5, h: 5, off: 4 };
const KNOB_R = 1.6;
const KNOB_H = 2.4;
const HOOK = [-92, -5.5]; // where the spare bookmark hangs on the counter
function counter() {
  const out = [];
  const frontPanel = seams(COUNTER, [FLOOR_Z + 3, COUNTER_Z - 2], "lo");
  out.push(S(k.slabOf(COUNTER, FLOOR_Z, COUNTER_Z - FLOOR_Z, P, 3, 0.5), { tone: "mid", inner: frontPanel }));
  // Drawer fronts on the counter face: verticals between the two panel lines, with pulls.
  const face = COUNTER.y + COUNTER.d;
  const verticals = [-70, -42, -14, 14, 42].map((x) => k.segment([x, face, FLOOR_Z + 3], [x, face, COUNTER_Z - 2], P)).join("");
  out.push(L(verticals, { tone: "lo" }));
  out.push(D([-56, -28, 0, 28].map((x) => at([x, face, FLOOR_Z + 12])), { size: 0.55, tone: "hi" }));
  out.push(slab({ x: COUNTER.x - 2, y: COUNTER.y - 2, w: COUNTER.w + 4, d: COUNTER.d + 4, r: 2 }, COUNTER_Z, 3, "mid", 4, 0.6));
  // Kartei tray and slot blocks.
  out.push(slab(KARTEI, TOP_Z, 2, "mid", 3, 0.4));
  out.push(L(k.planOutline(k.insetPlan(KARTEI, 1.8), TOP_Z + 2, P, 3), { tone: "faint" }));
  for (let i = 0; i < 5; i++) {
    const block = { x: cardX(i) - 4.5, y: CARD_Y - 10, w: 9, d: 20, r: 1 };
    out.push(slab(block, TOP_Z + 2, 3, "mid", 3, 0.4));
    out.push(L(k.planOutline({ x: cardX(i) - 1.9, y: CARD_Y - 8.3, w: 3.8, d: 16.6, r: 0.5 }, CARD_Z, P, 3), { tone: "faint" }));
    out.push(D([at([block.x + 2, block.y + 2, CARD_Z]), at([block.x + block.w - 2, block.y + block.d - 2, CARD_Z])], { size: 0.45 }));
  }
  // Hook block for the spare bookmark.
  const hook = { x: HOOK[0] - 5, y: HOOK[1] - 5, w: 10, d: 10, r: 1.2 };
  out.push(slab(hook, TOP_Z, 5, "mid", 3, 0.5));
  out.push(L(k.planOutline(k.insetPlan(hook, 2.4), TOP_Z + 5, P, 3), { tone: "faint" }));
  // Counter bell.
  out.push(cyl(46, -10, 3.2, TOP_Z, 1.2, "mid", 24), cyl(46, -10, 2.6, TOP_Z + 1.2, 2.6, "hi", 24), cyl(46, -10, 0.8, TOP_Z + 3.8, 1.4, "hi", 10));
  // Stool in front of the counter.
  out.push(legs({ x: -20, y: 16, w: 9, d: 9 }, 1, 1, FLOOR_Z, 14), cyl(-15.5, 20.5, 5.5, FLOOR_Z + 14, 2, "mid", 24));
  return out.join("");
}
function cardSvg(i, merge) {
  const x = cardX(i);
  const plan = { x: x - CARD.w / 2, y: CARD_Y - CARD.d / 2, w: CARD.w, d: CARD.d, r: 0.5 };
  const bands = [CARD_Z + 2.6 + i * 1.1];
  if (merge) bands.push(CARD_Z + 2.6 + i * 1.1 + 1.8);
  const inner = seams(plan, bands, "lo") + seams(plan, [CARD_Z + 9.4, CARD_Z + 11.4, CARD_Z + 13.4]);
  const out = [S(k.slabOf(plan, CARD_Z, CARD.h, P, 3, 0.4), { tone: "hi", crease: "lo", inner })];
  out.push(D([at([x + CARD.w / 2, CARD_Y + CARD.d / 2 - 2, CARD_TOP - 1.4]), at([x + CARD.w / 2, CARD_Y - CARD.d / 2 + 2, CARD_TOP - 1.4])], { size: 0.4, tone: "lo" }));
  return out.join("");
}
const cardClip = (i) => riseClip({ x: cardX(i) - CARD.w / 2, y: CARD_Y - CARD.d / 2, w: CARD.w, d: CARD.d, r: 0.5 }, CARD_Z);
function clipSvg(off, lit) {
  const cx = cardX(0);
  const y = CARD_Y + off;
  const block = { x: cx - CLIP.w / 2, y: y - CLIP.d / 2, w: CLIP.w, d: CLIP.d, r: 1 };
  const out = [S(k.slabOf(block, CLIP.z, CLIP.h, P, 3, 0.5), { tone: "hi", crease: "lo", lit })];
  out.push(D([at([cx + CLIP.w / 2, y - 1.8, CLIP.z + 1.6]), at([cx + CLIP.w / 2, y + 1.8, CLIP.z + 1.6])], { size: 0.4, tone: "lo" }));
  const top = CLIP.z + CLIP.h;
  out.push(S(k.cylinder(cx, y, KNOB_R, top, KNOB_H, P, 20), { tone: "hi", lit }));
  out.push(L(k.knurl(cx, y, KNOB_R, top, top + KNOB_H, 16, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([cx, y], [cx + KNOB_R, y], top + KNOB_H, P), { tone: lit ? "lit" : "hi" }));
  out.push(D([at([cx, y, top + KNOB_H])], { size: 0.45, tone: lit ? "lit" : "hi" }));
  return out.join("");
}
const clipHome = (off) => [cardX(0), CARD_Y + off, 0];
const clipAt = (index, off) => (index === null ? [HOOK[0], HOOK[1], TOP_Z + 5 - CLIP.z] : [cardX(index), CARD_Y + off, 0]);
const offsetTo = (home, pos) => [pos[0] - home[0], pos[1] - home[1], pos[2]];

// ---------- Binderei: the binding machine at the right ----------
const BIND = { x: 86, y: -14, w: 46, d: 36, r: 1.5 };
const BIND_C = [109, 4];
const BIND_Z = FLOOR_Z + 6;
const BPLATEN_Z = BIND_Z + 18;
function binder() {
  const out = [];
  out.push(slab(BIND, FLOOR_Z, 6, "mid", 3, 0.6, { inner: seams(BIND, [FLOOR_Z + 2.4]) }));
  out.push(D(k.corners(BIND, 3).map(([x, y]) => at([x, y, BIND_Z])), { size: 0.5 }));
  // Sheets gathered on the bed, waiting to be bound.
  for (let i = 0; i < 4; i++) out.push(slab({ x: BIND_C[0] - 9 + i * 0.25, y: BIND_C[1] - 8, w: 18, d: 16, r: 0.3 }, BIND_Z + i * 0.6, 0.6, "hi", 2, 0, { crease: "none" }));
  // Far post.
  out.push(cyl(BIND_C[0] - 16, BIND_C[1], 2.2, BIND_Z, 34, "mid", 20, "none"));
  out.push(L([BIND_Z + 8, BIND_Z + 24].map((z) => k.sideArc(BIND_C[0] - 16, BIND_C[1], 2.2, z, P, 14)).join(""), { tone: "faint" }));
  // Glue pot and brush on the base.
  out.push(cyl(BIND.x + 6, BIND.y + 30, 2.6, BIND_Z, 3.4, "mid", 16));
  out.push(L(k.ring(BIND.x + 6, BIND.y + 30, 1.8, BIND_Z + 3.4, P, 14), { tone: "lo" }));
  return out.join("");
}
function binderTop() {
  const out = [];
  out.push(cyl(BIND_C[0] + 16, BIND_C[1], 2.2, BIND_Z, 34, "mid", 20, "none"));
  out.push(L([BIND_Z + 8, BIND_Z + 24].map((z) => k.sideArc(BIND_C[0] + 16, BIND_C[1], 2.2, z, P, 14)).join(""), { tone: "faint" }));
  const bar = { x: BIND_C[0] - 19, y: BIND_C[1] - 4, w: 38, d: 8, r: 1 };
  out.push(slab(bar, BIND_Z + 34, 4, "mid", 3, 0.5));
  out.push(D([at([BIND_C[0] - 16, BIND_C[1], BIND_Z + 38]), at([BIND_C[0] + 16, BIND_C[1], BIND_Z + 38])], { size: 0.5 }));
  out.push(cyl(BIND_C[0], BIND_C[1], 3.6, BIND_Z + 38, 4.5, "mid", 28));
  out.push(L(k.knurl(BIND_C[0], BIND_C[1], 3.6, BIND_Z + 38, BIND_Z + 42.5, 28, P), { tone: "lo" }));
  out.push(L(k.lineOnTop(BIND_C, [BIND_C[0] + 3.6, BIND_C[1]], BIND_Z + 42.5, P), { tone: "hi" }));
  out.push(D([at([BIND_C[0], BIND_C[1], BIND_Z + 42.5])], { size: 0.5, tone: "hi" }));
  return out.join("");
}
function bplatenSvg() {
  const plan = { x: BIND_C[0] - 11, y: BIND_C[1] - 10, w: 22, d: 20, r: 1 };
  const out = [slab(plan, BPLATEN_Z, 4, "hi", 3, 0.5, { crease: "lo" })];
  out.push(cyl(BIND_C[0], BIND_C[1], 2.4, BPLATEN_Z + 4, BIND_Z + 34 - BPLATEN_Z - 4, "mid", 16, "none"));
  return out.join("");
}

// ---------- Schreibpult for the merge, with a lamp ----------
const DESK = { x: 66, y: -92, w: 66, d: 30, r: 1 };
const DESK_Z = FLOOR_Z + 22;
const LAMP = [122, -84];
function desk() {
  const out = [];
  out.push(legs(DESK, 4, 1.6, FLOOR_Z, DESK_Z - FLOOR_Z));
  out.push(slab({ x: DESK.x + 4, y: DESK.y + 24, w: DESK.w - 8, d: 2.4, r: 0.4 }, FLOOR_Z + 9, 2, "mid", 2, 0.2));
  out.push(slab(DESK, DESK_Z, 3, "mid", 3, 0.5, { inner: seams(DESK, [DESK_Z + 1.4]) }));
  // Two card trays and an ink pot on the desk.
  for (const x of [74, 92]) out.push(L(k.planOutline({ x, y: -86, w: 12, d: 18, r: 0.8 }, DESK_Z + 3, P, 3) + k.planOutline({ x: x + 1.4, y: -84.6, w: 9.2, d: 15.2, r: 0.5 }, DESK_Z + 3, P, 3), { tone: "lo" }));
  out.push(cyl(110, -70, 1.8, DESK_Z + 3, 2.6, "mid", 14));
  out.push(L(k.ring(110, -70, 1.1, DESK_Z + 5.6, P, 12), { tone: "lo" }));
  // Lamp: base, post, arm, head hanging under the arm.
  out.push(cyl(LAMP[0], LAMP[1], 3.2, DESK_Z + 3, 2, "mid", 20));
  out.push(cyl(LAMP[0], LAMP[1], 0.9, DESK_Z + 5, 22, "mid", 10, "none"));
  out.push(slab({ x: LAMP[0] - 13, y: LAMP[1] - 1, w: 14, d: 2, r: 0.6 }, DESK_Z + 27, 1.6, "mid", 2, 0.2));
  return out.join("");
}
function lampHead() {
  return `<g data-lamp>${cyl(LAMP[0] - 12, LAMP[1], 4.2, DESK_Z + 22, 5, "hi", 24)}${L(k.ring(LAMP[0] - 12, LAMP[1], 3, DESK_Z + 27, P, 20), { tone: "lo" })}</g>`;
}

// ---------- Schaufenster: the display and the window frame ----------
const PODIUM = { x: -66, y: 70, w: 132, d: 22, r: 1.5 };
const PODIUM_Z = FLOOR_Z + 12;
const BOOK_X = [-32, 12];
const BOOK = { w: 14, d: 5, h: 18 };
const BOOK_Y = 79.5;
const TAB_STEP = 2.6;
function podium() {
  const out = [];
  out.push(slab(PODIUM, FLOOR_Z, PODIUM_Z - FLOOR_Z, "mid", 3, 0.6, { inner: seams(PODIUM, [FLOOR_Z + 3, PODIUM_Z - 3], "lo") }));
  out.push(slab({ x: PODIUM.x - 1.5, y: PODIUM.y - 1.5, w: PODIUM.w + 3, d: PODIUM.d + 3, r: 2 }, PODIUM_Z, 2, "mid", 4, 0.5));
  for (const bx of BOOK_X) out.push(L(k.planOutline({ x: bx - 7.6, y: BOOK_Y - 2.9, w: 15.2, d: 6.6, r: 0.5 }, PODIUM_Z + 2, P, 3), { tone: "faint" }));
  // A small easel card and a potted plant on the podium.
  out.push(slab({ x: 40, y: 76, w: 9, d: 0.8, r: 0.2 }, PODIUM_Z + 2, 7, "hi", 2, 0.2));
  out.push(cyl(-52, 80, 3.4, PODIUM_Z + 2, 5, "mid", 20), cyl(-52, 80, 2.4, PODIUM_Z + 7, 6, "lo", 16, "none"), cyl(-52, 80, 4, PODIUM_Z + 13, 2.4, "mid", 20));
  return out.join("");
}
function bookSvg(bx) {
  const body = { x: bx - BOOK.w / 2, y: BOOK_Y - BOOK.d / 2, w: BOOK.w, d: BOOK.d, r: 0.6 };
  const z = PODIUM_Z + 2;
  const out = [S(k.slabOf(body, z, BOOK.h, P, 3, 0.4), { tone: "hi", crease: "lo", inner: seams(body, [z + BOOK.h - 2.4]) })];
  const cover = { x: bx - BOOK.w / 2 - 0.4, y: BOOK_Y + BOOK.d / 2, w: BOOK.w + 0.8, d: 0.9, r: 0.3 };
  out.push(S(k.slabOf(cover, z - 0.2, BOOK.h + 0.5, P, 2, 0.3), { tone: "hi", crease: "lo", inner: seams(cover, [z + 7, z + 9, z + 11]) }));
  return out.join("");
}
function tabSvg(bx) {
  const z = PODIUM_Z + 2 + BOOK.h;
  const cx = bx - 4.2;
  return slab({ x: cx - 1.5, y: BOOK_Y - 1.4, w: 3, d: 2.8, r: 0.5 }, z, 1.4, "hi", 2, 0.2, { crease: "lo" }) + D([at([cx, BOOK_Y, z + 1.4])], { size: 0.4, tone: "lo" });
}
const bookClip = (bx) => riseClip({ x: bx - BOOK.w / 2 - 0.4, y: BOOK_Y - BOOK.d / 2, w: BOOK.w + 0.8, d: BOOK.d + 0.9, r: 0.5 }, PODIUM_Z + 2);
function windowFrame() {
  const out = [];
  const sill = { x: -70, y: 91, w: 140, d: 4, r: 0.8 };
  out.push(slab(sill, FLOOR_Z, 4, "mid", 3, 0.4));
  for (const px of [-70, 70]) {
    out.push(cyl(px, 93, 3, FLOOR_Z + 4, 2, "mid", 20));
    out.push(cyl(px, 93, 2.3, FLOOR_Z + 6, 32, "mid", 20, "none"));
    out.push(L([FLOOR_Z + 14, FLOOR_Z + 26].map((z) => k.sideArc(px, 93, 2.3, z, P, 14)).join(""), { tone: "faint" }));
  }
  out.push(slab({ x: -1, y: 92, w: 2, d: 2.4, r: 0.4 }, FLOOR_Z + 8, 28, "mid", 2, 0, { crease: "lo" }));
  out.push(slab({ x: -73, y: 90.5, w: 146, d: 5, r: 1 }, FLOOR_Z + 38, 4, "mid", 3, 0.5, { inner: seams({ x: -73, y: 90.5, w: 146, d: 5, r: 1 }, [FLOOR_Z + 39.6]) }));
  out.push(D([at([-70, 93, FLOOR_Z + 42]), at([70, 93, FLOOR_Z + 42])], { size: 0.5 }));
  // The door beside the window.
  const DOOR = { x: 90, y: 91.5, w: 22, d: 2.2, r: 0.3 };
  out.push(slab({ x: 86, y: 90.5, w: 3.5, d: 4, r: 0.4 }, FLOOR_Z, 48, "mid", 2, 0.3));
  out.push(slab({ x: 112.5, y: 90.5, w: 3.5, d: 4, r: 0.4 }, FLOOR_Z, 48, "mid", 2, 0.3));
  const doorInner = seams(DOOR, [FLOOR_Z + 6, FLOOR_Z + 24, FLOOR_Z + 28, FLOOR_Z + 42], "lo") + L([94, 108].map((x) => k.segment([x, DOOR.y + DOOR.d, FLOOR_Z + 6], [x, DOOR.y + DOOR.d, FLOOR_Z + 24], P) + k.segment([x, DOOR.y + DOOR.d, FLOOR_Z + 28], [x, DOOR.y + DOOR.d, FLOOR_Z + 42], P)).join(""), { tone: "lo" });
  out.push(S(k.slabOf(DOOR, FLOOR_Z, 48, P, 2, 0.3), { tone: "hi", crease: "lo", inner: doorInner }));
  out.push(D([at([108.5, DOOR.y + DOOR.d, FLOOR_Z + 22])], { size: 0.7, tone: "hi" }));
  out.push(slab({ x: 84, y: 89.5, w: 34, d: 6, r: 0.8 }, FLOOR_Z + 48, 4, "mid", 3, 0.4));
  return out.join("");
}


export {
  P, k, at, S, L, D, depth, riseClip, cyl, slab, seams, legs,
  FLOOR, FLOOR_Z, WALL_H, BACK, LEFT, WALK,
  building, bookcase, rack, sheetSvg, sheetClip, sheetX, SHEET, SHEET_Y, RACK_Z,
  press, pressTop, platenSvg, PRESS_C, PLATEN_Z, BED_Z,
  counter, cardSvg, cardClip, cardX, clipSvg, clipHome, clipAt, offsetTo, CARD, CARD_Y, CARD_Z, CARD_TOP, CLIP, HOOK, TOP_Z,
  binder, binderTop, bplatenSvg, BIND_C, BIND_Z, BPLATEN_Z,
  desk, lampHead, LAMP, DESK, DESK_Z,
  podium, bookSvg, tabSvg, bookClip, windowFrame, BOOK_X, BOOK, BOOK_Y, PODIUM_Z, TAB_STEP,
};
