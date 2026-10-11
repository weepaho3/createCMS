// The multiplane rostrum camera: the one machine the "How createCMS works" scenes are drawn from.
// Built with the Anatomy isometric kit (scripts/figures/kit, MIT). Every builder takes the projection P.
import * as k from './kit/iso-kit.mjs';

export { k };

// ---------- Layout in world units (x right, y toward the viewer, z up) ----------
export const PLATE = { x: -150, y: -90, w: 300, d: 180, r: 8 };
export const PLATE_H = 12;
export const FOOT_H = 5;
export const STAND = { x: -72, y: -88, w: 124, d: 32, r: 3 }; // the heavy foot of the column
export const STAND_H = 8;
export const COLUMN = [-10, -72]; // x, y of the column axis
export const COLUMN_R = 5;
export const COLUMN_TOP = 166;
export const FRAME = { x: -56, y: -52, w: 112, d: 84, r: 2 }; // outer plan of each glass plane's frame
export const BAR = 5; // frame bar width
export const PLANE_Z = [38, 72, 106]; // bottom to top: hero plane, text plane, gallery plane
export const PLANE_H = 2.2;
export const CEL_H = 0.6;
export const LENS = [0, -10]; // the camera looks straight down onto the frame centre
export const CAMERA_Z = 142;
export const CABINET = { x: -142, y: -46, w: 48, d: 58, r: 2 };
export const TABLE = { x: -124, y: 30, w: 210, d: 46, r: 3 }; // the light table with the film strip
export const TABLE_H = 6;
export const STRIP = { x: -112, y: 44, w: 160, d: 11, r: 0.6 };
export const STRIP_H = 0.8;
export const FRAME_PITCH = 26;
export const PROJECTOR = { x: 98, y: -22, w: 36, d: 26, r: 2 };
export const PEDESTAL = { x: 94, y: -26, w: 44, d: 34, r: 2.5 };

// The entry on the planes: hero on the bottom plane, text on the middle, the gallery group's three images on top.
export const CELS = {
  hero: { plane: 0, plan: { x: -48, y: -46, w: 96, d: 70, r: 1 } },
  text: { plane: 1, plan: { x: -44, y: -42, w: 40, d: 52, r: 1 } },
  img1: { plane: 2, plan: { x: -34, y: -8, w: 22, d: 26, r: 1 } },
  img2: { plane: 2, plan: { x: -8, y: -8, w: 22, d: 26, r: 1 } },
  img3: { plane: 2, plan: { x: 18, y: -8, w: 22, d: 26, r: 1 } },
};

export function makeMachine(P) {
  const at = (p) => k.iso(p, P);
  const S = (paths, style) => k.solidSvg(paths, style);
  const L = (d, style) => k.lineSvg(d, style);
  const D = (points, style) => k.dotsSvg(points, style);
  const depth = (x, y, z = 0) => k.depthOf([x, y, z], P);
  const cyl = (x, y, r, z, h, tone = 'mid', steps = 20, crease) =>
    S(k.cylinder(x, y, r, z, h, P, steps), { tone, crease });
  const slab = (plan, z, h, tone = 'mid', steps = 3, bevel = 0.4, extra = {}) =>
    S(k.slabOf(plan, z, h, P, steps, bevel), { tone, ...extra });
  const seams = (plan, zs, tone = 'faint', steps = 3) =>
    zs.map((z) => L(k.sideSeam(plan, z, P, steps), { tone })).join('');
  const byDepth = (points) =>
    [...points].sort((a, b) => depth(a[0], a[1]) - depth(b[0], b[1]));

  function plate() {
    const out = [
      `<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`,
    ];
    for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
      out.push(
        cyl(x, y, 7, -PLATE_H - FOOT_H, 1.6, 'lo', 28),
        cyl(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, 'mid', 28),
      );
    }
    out.push(slab(PLATE, -PLATE_H, PLATE_H, 'mid', 8, 1.6));
    out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: 'lo' }));
    const screws = k.corners(PLATE, 10);
    out.push(
      L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(''), {
        tone: 'lo',
      }),
    );
    out.push(
      D(
        screws.map(([x, y]) => at([x, y, 0])),
        { size: 0.5 },
      ),
    );
    return out.join('');
  }

  // Column on its foot, with a rack of rings the plane carriers lock into.
  function column(zTo = COLUMN_TOP) {
    const out = [
      slab(STAND, 0, STAND_H, 'lo', 4, 0.8, {
        inner: seams(STAND, [STAND_H - 1.6], 'lo'),
      }),
    ];
    out.push(
      D(
        k.corners(STAND, 4).map(([x, y]) => at([x, y, STAND_H])),
        { size: 0.5 },
      ),
    );
    out.push(cyl(COLUMN[0], COLUMN[1], COLUMN_R + 3, STAND_H, 5, 'mid', 28));
    out.push(
      cyl(
        COLUMN[0],
        COLUMN[1],
        COLUMN_R,
        STAND_H + 5,
        zTo - STAND_H - 5,
        'mid',
        28,
        'none',
      ),
    );
    const rings = [];
    for (let z = STAND_H + 14; z < zTo - 6; z += 10)
      rings.push(k.sideArc(COLUMN[0], COLUMN[1], COLUMN_R, z, P, 18));
    out.push(L(rings.join(''), { tone: 'faint' }));
    return out.join('');
  }
  function columnCap() {
    return cyl(COLUMN[0], COLUMN[1], COLUMN_R + 1.4, COLUMN_TOP, 3, 'mid', 28);
  }

  // One glass plane: a carrier clamped to the column, an arm, the frame of four bars, the glass as an inset outline.
  function plane(level) {
    const z = PLANE_Z[level];
    const out = [];
    out.push(
      cyl(COLUMN[0], COLUMN[1], COLUMN_R + 2.6, z - 3, PLANE_H + 6, 'mid', 28),
    );
    const arm = {
      x: COLUMN[0] - 4,
      y: COLUMN[1] + 2,
      w: 8,
      d: FRAME.y - COLUMN[1] + BAR - 2,
      r: 1,
    };
    out.push(slab(arm, z - 1, PLANE_H + 2, 'mid', 3, 0.4));
    out.push(
      D([at([COLUMN[0], COLUMN[1] + 10, z + PLANE_H + 1])], { size: 0.5 }),
    );
    // Thumb screw on the carrier.
    out.push(
      cyl(COLUMN[0] + COLUMN_R + 4.6, COLUMN[1], 2, z - 1, 4, 'mid', 14),
      L(
        k.knurl(COLUMN[0] + COLUMN_R + 4.6, COLUMN[1], 2, z - 1, z + 3, 14, P),
        { tone: 'lo' },
      ),
    );
    const bars = [
      { x: FRAME.x, y: FRAME.y, w: FRAME.w, d: BAR, r: 1 },
      { x: FRAME.x, y: FRAME.y, w: BAR, d: FRAME.d, r: 1 },
    ];
    for (const b of bars) out.push(slab(b, z, PLANE_H, 'mid', 3, 0.4));
    out.push(
      L(k.planOutline(k.insetPlan(FRAME, BAR), z + PLANE_H - 0.6, P, 3), {
        tone: 'faint',
      }),
    );
    out.push(
      D(
        k.corners(FRAME, 2.5).map(([x, y]) => at([x, y, z + PLANE_H])),
        { size: 0.45 },
      ),
    );
    return out.join('');
  }
  function planeFront(level) {
    const z = PLANE_Z[level];
    const bars = [
      { x: FRAME.x, y: FRAME.y + FRAME.d - BAR, w: FRAME.w, d: BAR, r: 1 },
      { x: FRAME.x + FRAME.w - BAR, y: FRAME.y, w: BAR, d: FRAME.d, r: 1 },
    ];
    return bars.map((b) => slab(b, z, PLANE_H, 'mid', 3, 0.4)).join('');
  }

  // A cel lying on its glass: a thin sheet with its drawing on top. `kind` picks the drawing.
  function cel(
    id,
    { plan, plane: level },
    kind,
    { tone = 'hi', lit = false } = {},
  ) {
    const z = PLANE_Z[level] + PLANE_H - 0.6;
    const out = [slab(plan, z, CEL_H, tone, 3, 0.25, { crease: 'lo', lit })];
    const top = z + CEL_H;
    const lines = [];
    if (kind === 'hero') {
      lines.push(
        k.planOutline(
          {
            x: plan.x + 8,
            y: plan.y + 8,
            w: plan.w - 16,
            d: plan.d * 0.5,
            r: 1,
          },
          top,
          P,
          3,
        ),
      );
      lines.push(
        k.lineOnTop(
          [plan.x + 8, plan.y + plan.d - 18],
          [plan.x + plan.w * 0.7, plan.y + plan.d - 18],
          top,
          P,
        ),
      );
      lines.push(
        k.lineOnTop(
          [plan.x + 8, plan.y + plan.d - 11],
          [plan.x + plan.w * 0.5, plan.y + plan.d - 11],
          top,
          P,
        ),
      );
    } else if (kind === 'text') {
      for (let i = 0; i < 6; i++)
        lines.push(
          k.lineOnTop(
            [plan.x + 5, plan.y + 7 + i * 7],
            [plan.x + plan.w - (i % 3 === 2 ? 14 : 5), plan.y + 7 + i * 7],
            top,
            P,
          ),
        );
    } else {
      lines.push(k.planOutline(k.insetPlan(plan, 3), top, P, 3));
      lines.push(
        k.lineOnTop(
          [plan.x + 3, plan.y + plan.d - 3],
          [plan.x + plan.w * 0.45, plan.y + plan.d * 0.45],
          top,
          P,
        ),
      );
      lines.push(
        k.lineOnTop(
          [plan.x + plan.w * 0.45, plan.y + plan.d * 0.45],
          [plan.x + plan.w - 3, plan.y + plan.d * 0.7],
          top,
          P,
        ),
      );
    }
    out.push(L(lines.join(''), { tone: 'lo', free: kind !== 'image' }));
    return `<g class="blk" data-block="${id}">${out.join('')}</g>`;
  }

  // The camera at the top of the column: arm, body, magazine, lens pointing down, crank.
  function camera() {
    const out = [];
    const arm = {
      x: COLUMN[0] - 4,
      y: COLUMN[1] + 2,
      w: 8,
      d: LENS[1] - COLUMN[1] + 8,
      r: 1,
    };
    out.push(slab(arm, COLUMN_TOP - 8, 6, 'mid', 3, 0.5));
    out.push(
      cyl(COLUMN[0], COLUMN[1], COLUMN_R + 2.8, COLUMN_TOP - 12, 10, 'mid', 28),
    );
    const body = { x: LENS[0] - 15, y: LENS[1] - 14, w: 30, d: 28, r: 2 };
    out.push(
      cyl(LENS[0], LENS[1], 7.5, CAMERA_Z - 12, 3, 'mid', 28),
      L(k.ring(LENS[0], LENS[1], 5, CAMERA_Z - 12, P, 24), { tone: 'lo' }),
    );
    out.push(cyl(LENS[0], LENS[1], 6, CAMERA_Z - 9, 9, 'hi', 28, 'lo'));
    out.push(
      L(
        [CAMERA_Z - 6, CAMERA_Z - 3]
          .map((z) => k.sideArc(LENS[0], LENS[1], 6, z, P, 16))
          .join(''),
        { tone: 'faint' },
      ),
    );
    out.push(
      slab(body, CAMERA_Z, 22, 'mid', 3, 0.6, {
        inner: seams(body, [CAMERA_Z + 4, CAMERA_Z + 18], 'lo'),
      }),
    );
    out.push(
      D(
        [
          at([body.x + 4, body.y + body.d, CAMERA_Z + 11]),
          at([body.x + body.w - 4, body.y + body.d, CAMERA_Z + 11]),
        ],
        { size: 0.5, tone: 'lo' },
      ),
    );
    // Film magazine: two reels in a housing on top.
    out.push(
      cyl(LENS[0] - 7, LENS[1] - 2, 8, CAMERA_Z + 22, 4, 'mid', 28),
      cyl(LENS[0] + 8, LENS[1] + 2, 8, CAMERA_Z + 22, 4, 'mid', 28),
    );
    out.push(
      D(
        [
          at([LENS[0] - 7, LENS[1] - 2, CAMERA_Z + 26]),
          at([LENS[0] + 8, LENS[1] + 2, CAMERA_Z + 26]),
        ],
        { size: 0.6 },
      ),
    );
    out.push(
      L(
        k.ring(LENS[0] - 7, LENS[1] - 2, 5, CAMERA_Z + 26, P, 20) +
          k.ring(LENS[0] + 8, LENS[1] + 2, 5, CAMERA_Z + 26, P, 20),
        { tone: 'lo' },
      ),
    );
    // Crank on the near side.
    out.push(
      slab(
        { x: body.x + body.w, y: LENS[1] - 1.2, w: 4, d: 2.4, r: 0.6 },
        CAMERA_Z + 9,
        2.4,
        'mid',
        2,
        0.2,
      ),
    );
    out.push(
      cyl(body.x + body.w + 5.4, LENS[1], 3.2, CAMERA_Z + 7, 6, 'mid', 22),
      L(
        k.knurl(
          body.x + body.w + 5.4,
          LENS[1],
          3.2,
          CAMERA_Z + 7,
          CAMERA_Z + 13,
          22,
          P,
        ),
        { tone: 'lo' },
      ),
    );
    out.push(
      L(
        k.lineOnTop(
          [body.x + body.w + 5.4, LENS[1]],
          [body.x + body.w + 8.6, LENS[1]],
          CAMERA_Z + 13,
          P,
        ),
        { tone: 'hi' },
      ),
      D([at([body.x + body.w + 5.4, LENS[1], CAMERA_Z + 13])], {
        size: 0.5,
        tone: 'hi',
      }),
    );
    return out.join('');
  }

  // Cel cabinet: an open rack with three shelves, spare cels standing on them.
  function cabinet(withCels = true) {
    const C = CABINET;
    const out = [slab(C, 0, 3, 'mid', 3, 0.4)];
    for (const x of [C.x, C.x + C.w - 2.4])
      out.push(
        slab({ x, y: C.y, w: 2.4, d: C.d, r: 0.3 }, 3, 40, 'mid', 2, 0.3),
      );
    const shelves = [3, 16, 29];
    shelves.forEach((z, row) => {
      out.push(
        slab(
          { x: C.x + 2.4, y: C.y + 1, w: C.w - 4.8, d: C.d - 1, r: 0.3 },
          z,
          1.4,
          'mid',
          2,
          0.2,
        ),
      );
      if (!withCels) return;
      for (let i = 0; i < 3; i++) {
        const cx = C.x + 10 + i * 13 + (row % 2) * 2;
        const plan = { x: cx - 0.7, y: C.y + 6, w: 1.4, d: C.d - 12, r: 0.3 };
        out.push(
          S(k.slabOf(plan, z + 1.4, 10, P, 2, 0.2), {
            tone: 'hi',
            crease: 'lo',
            inner: seams(plan, [z + 4.4, z + 7.4, z + 10.4]),
          }),
        );
      }
    });
    out.push(
      slab(
        { x: C.x - 1, y: C.y - 1, w: C.w + 2, d: C.d + 2, r: 0.6 },
        43,
        2.4,
        'mid',
        3,
        0.4,
      ),
    );
    return out.join('');
  }

  // Light table with a developed film strip laid out on it: the commit chain. `frames` is how many frames are exposed.
  function filmTable(frames = 1) {
    const out = [
      slab(TABLE, 0, TABLE_H, 'lo', 4, 0.6, {
        inner: seams(TABLE, [TABLE_H - 1.4], 'lo'),
      }),
    ];
    out.push(
      L(k.planOutline(k.insetPlan(TABLE, 3), TABLE_H, P, 4), { tone: 'faint' }),
    );
    out.push(
      D(
        k.corners(TABLE, 5).map(([x, y]) => at([x, y, TABLE_H])),
        { size: 0.5 },
      ),
    );
    // A spare reel at the left end.
    out.push(
      cyl(TABLE.x + 20, TABLE.y + 14, 12, TABLE_H, 2.6, 'mid', 36),
      L(
        k.ring(TABLE.x + 20, TABLE.y + 14, 4, TABLE_H + 2.6, P, 20) +
          k.ring(TABLE.x + 20, TABLE.y + 14, 10, TABLE_H + 2.6, P, 36),
        { tone: 'lo' },
      ),
    );
    out.push(
      D([at([TABLE.x + 20, TABLE.y + 14, TABLE_H + 2.6])], { size: 0.6 }),
    );
    return out.join('');
  }
  function strip(frames, { y = STRIP.y, x0 = STRIP.x, tone = 'hi' } = {}) {
    const plan = {
      x: x0,
      y,
      w: Math.max(1, frames) * FRAME_PITCH + 6,
      d: STRIP.d,
      r: 0.6,
    };
    const out = [slab(plan, TABLE_H, STRIP_H, tone, 2, 0.2, { crease: 'lo' })];
    const top = TABLE_H + STRIP_H;
    const holes = [];
    const windows = [];
    for (let i = 0; i < frames; i++) {
      const fx = x0 + 3 + i * FRAME_PITCH;
      windows.push(
        k.planOutline(
          {
            x: fx + 2,
            y: y + 2.4,
            w: FRAME_PITCH - 4,
            d: STRIP.d - 4.8,
            r: 0.5,
          },
          top,
          P,
          2,
        ),
      );
      for (let h = 0; h < 4; h++)
        holes.push(
          at([fx + 3 + h * 6, y + 1.1, top]),
          at([fx + 3 + h * 6, y + STRIP.d - 1.1, top]),
        );
    }
    out.push(
      L(windows.join(''), { tone: 'lo' }),
      D(holes, { size: 0.35, tone: 'lo' }),
    );
    return { svg: out.join(''), plan };
  }
  // A pointer clip at the end of a strip: a branch head.
  function clip(x, y, lit = false) {
    const z = TABLE_H + STRIP_H;
    const block = { x: x - 3, y: y - 3, w: 6, d: 6, r: 1 };
    const out = [slab(block, z - 1, 4.5, 'hi', 3, 0.5, { crease: 'lo', lit })];
    out.push(
      cyl(x, y, 1.6, z + 3.5, 2.2, 'hi', 16),
      L(k.knurl(x, y, 1.6, z + 3.5, z + 5.7, 14, P), { tone: 'lo' }),
    );
    out.push(
      L(k.lineOnTop([x, y], [x + 1.6, y], z + 5.7, P), {
        tone: lit ? 'lit' : 'hi',
      }),
      D([at([x, y, z + 5.7])], { size: 0.45, tone: lit ? 'lit' : 'hi' }),
    );
    return out.join('');
  }

  // Projector on a pedestal: body, lens barrel toward the right, two reels on top, a switch.
  function projector() {
    const out = [
      slab(PEDESTAL, 0, 10, 'mid', 3, 0.6, {
        inner: seams(PEDESTAL, [2.4], 'lo'),
      }),
    ];
    out.push(
      D(
        k.corners(PEDESTAL, 3).map(([x, y]) => at([x, y, 10])),
        { size: 0.5 },
      ),
    );
    const B = PROJECTOR;
    out.push(
      slab(B, 10, 22, 'mid', 3, 0.6, { inner: seams(B, [14, 28], 'lo') }),
    );
    out.push(
      L(
        k.planOutline(
          { x: B.x + 6, y: B.y + 6, w: B.w - 12, d: B.d - 12, r: 1 },
          32,
          P,
          3,
        ),
        { tone: 'faint' },
      ),
    );
    out.push(
      slab(
        { x: B.x + B.w, y: B.y + 9, w: 9, d: 8, r: 1.5 },
        17,
        8,
        'mid',
        3,
        0.4,
      ),
    );
    out.push(
      slab(
        { x: B.x + B.w + 9, y: B.y + 8, w: 2.6, d: 10, r: 1.5 },
        16,
        10,
        'hi',
        3,
        0.3,
      ),
    );
    out.push(
      L(k.sideRing([B.x + B.w + 11.6, B.y + 13, 21], 3.4, 'x', P, 20), {
        tone: 'lo',
      }),
    );
    out.push(
      cyl(B.x + 9, B.y + 11, 10, 32, 2.6, 'mid', 36),
      cyl(B.x + 27, B.y + 11, 10, 32, 2.6, 'mid', 36),
    );
    out.push(
      L(
        k.ring(B.x + 9, B.y + 11, 3.4, 34.6, P, 18) +
          k.ring(B.x + 27, B.y + 11, 3.4, 34.6, P, 18) +
          k.ring(B.x + 9, B.y + 11, 8, 34.6, P, 36) +
          k.ring(B.x + 27, B.y + 11, 8, 34.6, P, 36),
        { tone: 'lo' },
      ),
    );
    out.push(
      D([at([B.x + 9, B.y + 11, 34.6]), at([B.x + 27, B.y + 11, 34.6])], {
        size: 0.6,
      }),
    );
    out.push(
      cyl(B.x + 30, B.y + B.d + 2.4, 2, 20, 3, 'mid', 14),
      L(k.knurl(B.x + 30, B.y + B.d + 2.4, 2, 20, 23, 12, P), { tone: 'lo' }),
    );
    return out.join('');
  }

  return {
    at,
    S,
    L,
    D,
    depth,
    cyl,
    slab,
    seams,
    byDepth,
    plate,
    column,
    columnCap,
    plane,
    planeFront,
    cel,
    camera,
    cabinet,
    filmTable,
    strip,
    clip,
    projector,
  };
}
