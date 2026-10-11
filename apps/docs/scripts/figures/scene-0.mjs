// Scene 0: the whole multiplane camera, with five numbered stations.
import * as M from './camera-parts.mjs';
import { writeScene } from './lib.mjs';

const { k } = M;
const WIDTH = 640;
const HEIGHT = 460;

const P = k.fitProjection(
  [
    ...k.boxCorners(M.PLATE, -M.PLATE_H - M.FOOT_H, 0),
    [M.LENS[0] + 12, M.LENS[1] - 10, M.CAMERA_Z + 26],
    [M.COLUMN[0], M.COLUMN[1], M.COLUMN_TOP + 3],
    [M.CABINET.x, M.CABINET.y, 46],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 42 },
);
const m = M.makeMachine(P);

const STATIONS = [
  {
    n: 1,
    name: 'The cel cabinet',
    tables: 'block_versions',
    says: 'Every drawing ever made is a cel in the cabinet. Changing a block means drawing a new cel; the old one stays.',
  },
  {
    n: 2,
    name: 'The glass planes',
    tables: 'roots · block_versions',
    says: 'One entry lies on the planes: each block is a cel, a group of blocks is a plane with its children on it.',
  },
  {
    n: 3,
    name: 'The camera',
    tables: 'commits · commit_snapshots',
    says: 'A commit is one exposure: the camera photographs the stack, and the negative records exactly which cels were in it.',
  },
  {
    n: 4,
    name: 'The film strip',
    tables: 'commits · branches',
    says: 'Exposed frames form the strip, one after another. A branch is a pointer clip on the frame a strip ends with.',
  },
  {
    n: 5,
    name: 'The projector',
    tables: 'publications',
    says: "Publishing threads a strip into the projector. It always shows the strip's last frame, from the finished negative, never from the cels.",
  },
];
const st = (n, svg) => `<g class="st" data-station="${n}">${svg}</g>`;

const planesSvg = [0, 1, 2]
  .map((level) => {
    const cels = Object.entries(M.CELS)
      .filter(([, c]) => c.plane === level)
      .map(([id, c]) =>
        m.cel(id, c, id === 'hero' ? 'hero' : id === 'text' ? 'text' : 'image'),
      )
      .join('');
    return m.plane(level) + cels + m.planeFront(level);
  })
  .join('');
const strip1 = m.strip(5);
const headX = strip1.plan.x + 3 + 4 * M.FRAME_PITCH + M.FRAME_PITCH / 2;

function tag(n, x, y, z) {
  const [sx, sy] = k.iso([x, y, z], P);
  return `<g class="tag" data-tag="${n}" transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})"><circle r="7.5" class="tag-disc"/><text y="3" text-anchor="middle" class="tag-num">${n}</text></g>`;
}
const TAGS = [
  [1, M.CABINET.x + 24, M.CABINET.y + 30, 56],
  [2, 40, -40, 100],
  [3, 18, -24, 164],
  [4, M.STRIP.x + 70, M.STRIP.y + 5, 20],
  [5, M.PROJECTOR.x + 18, M.PROJECTOR.y + 13, 48],
];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    'A multiplane rostrum camera on a base plate: a column on a heavy foot carries three glass planes, each with transparent cels lying on it, and a camera at the top pointing straight down at them. A cabinet of spare cels stands to the left. At the front, a developed film strip with five frames lies on a light table, a pointer clip at its last frame. A projector with two reels stands on a pedestal to the right. Five numbered tags mark the stations.',
  body: [
    m.plate(),
    st(1, m.cabinet()),
    m.column(),
    st(2, planesSvg),
    st(3, m.camera() + m.columnCap()),
    st(
      4,
      m.filmTable() + strip1.svg + m.clip(headX, M.STRIP.y + M.STRIP.d / 2),
    ),
    st(5, m.projector()),
    TAGS.map(([n, x, y, z]) => tag(n, x, y, z)).join(''),
  ],
});

const live = `
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const STATIONS = ${JSON.stringify(STATIONS)};
const N = STATIONS.length;
const buttons = [...document.querySelectorAll("[data-pick]")];
let current = 0;
function select(n) {
  current = n;
  svg.toggleAttribute("data-focus", n > 0);
  svg.querySelectorAll(".st").forEach((g) => g.toggleAttribute("data-on", +g.dataset.station === n));
  svg.querySelectorAll(".tag").forEach((g) => g.toggleAttribute("data-on", +g.dataset.tag === n));
  buttons.forEach((b) => b.setAttribute("aria-pressed", +b.dataset.pick === n ? "true" : "false"));
  const s = STATIONS.find((x) => x.n === n);
  const text = s ? "0" + s.n + " " + s.name + " · " + s.tables : "the whole machine · hover a station";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuetext", s ? s.name + ": " + s.says : "Overview of the camera");
  const cap = document.querySelector("[data-says]");
  if (cap) cap.textContent = s ? s.says : "One machine, five stations. Hover one or press 1 to 5.";
}
svg.querySelectorAll(".st, .tag").forEach((g) => g.addEventListener("pointerenter", () => select(+(g.dataset.station || g.dataset.tag))));
svg.addEventListener("pointerleave", () => select(0));
buttons.forEach((b) => b.addEventListener("click", () => select(current === +b.dataset.pick ? 0 : +b.dataset.pick)));
stage.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= String(N)) { select(+e.key); e.preventDefault(); }
  if (e.key === "ArrowRight") { select(current % N + 1); e.preventDefault(); }
  if (e.key === "ArrowLeft") { select((current + N - 2) % N + 1); e.preventDefault(); }
  if (e.key === "Escape") select(0);
});
let touring = !matchMedia("(prefers-reduced-motion: reduce)").matches, tourAt = 0, timer = 0;
const step = () => { if (!touring) return; tourAt = tourAt % N + 1; select(tourAt); timer = setTimeout(step, 2600); };
timer = setTimeout(step, 1400);
["pointerenter", "pointerdown", "keydown", "focusin"].forEach((ev) => stage.addEventListener(ev, () => { touring = false; clearTimeout(timer); }));
select(0);
`;

const body =
  k.plateHtml({
    fig: 'Fig 0',
    title: 'The camera',
    hint: 'Hover a station or press 1 to 5',
    readout: 'the whole machine · hover a station',
    keys: [],
    caption: '',
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Map of the camera: number keys 1 to 5 select a station">${svg}</div>`,
  }) +
  `<div class="picks">${STATIONS.map((s) => `<button type="button" data-pick="${s.n}" aria-pressed="false"><b>0${s.n}</b> ${s.name}</button>`).join('')}</div><p class="says" data-says></p>` +
  `<style>
    .iso-svg[data-focus] .st:not([data-on]) { opacity: .28; transition: opacity .35s; }
    .iso-svg .st { transition: opacity .35s; }
    .tag-disc { fill: var(--anatomy-paper); stroke: var(--anatomy-hi); stroke-width: .8; }
    .tag-num { font: 700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace; fill: var(--anatomy-hi); }
    .tag { cursor: pointer; }
    .tag[data-on] .tag-disc { fill: var(--anatomy-hi); }
    .tag[data-on] .tag-num { fill: var(--anatomy-paper); }
    .picks { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
    .picks button { font: 500 12px/1.2 system-ui, sans-serif; color: var(--anatomy-hi); background: transparent; border: 1px solid var(--anatomy-lo); border-radius: 999px; padding: 5px 10px; cursor: pointer; }
    .picks button b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 600; opacity: .7; margin-right: 4px; }
    .picks button[aria-pressed="true"] { background: var(--anatomy-hi); color: var(--anatomy-paper); border-color: var(--anatomy-hi); }
    .says { font: 14px/1.45 system-ui, sans-serif; color: var(--anatomy-hi); margin: 10px 0 0; min-height: 2.9em; }
  </style>`;

writeScene('scene-0', {
  title: 'How createCMS works · Fig 0 The camera',
  body,
  script: live,
});
