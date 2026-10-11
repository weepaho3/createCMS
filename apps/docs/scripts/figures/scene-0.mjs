// Scene 0: the whole shop as a map. Seven numbered stations; hovering or pressing a number lights one up.
import * as S from "./shop-parts.mjs";
import { writeScene } from "./lib.mjs";

const { k, P, WIDTH, HEIGHT } = S;

// Everything stands in its final state: every sheet printed, five Fassungen, both bookmarks placed, two books bound.
const STATIONS = [
  { n: 1, name: "The books", tables: "roots", says: "Every entry of a collection is one book. The bookcase holds the finished ones." },
  { n: 2, name: "The press", tables: "block_versions", says: "Every change prints one new sheet, a block version. Nothing is overprinted." },
  { n: 3, name: "The archive", tables: "block_versions", says: "Every sheet ever printed stays in its pigeonhole, old and new side by side." },
  { n: 4, name: "The card index", tables: "commits · commit_snapshots · branches", says: "One card per Fassung (commit): a table of contents naming the sheet for every block. The clips on the cards are the branches." },
  { n: 5, name: "The writing desk", tables: "merge_requests · merge_conflicts", says: "A merge is written here: two tables of contents compared against their common ancestor." },
  { n: 6, name: "The binding machine", tables: "publications", says: "Publishing binds a book from the card a bookmark sits on, and rebinds it whenever the bookmark moves." },
  { n: 7, name: "The shop window", tables: "getPublishedContent", says: "One bound book per published branch. Visitors read from the window, never from the workshop." },
];

const st = (n, svg) => `<g class="st" data-station="${n}">${svg}</g>`;

// Static versions of the moving parts.
const sheets = ["A1", "A2", "B1", "B2", "C1", "C2"].map((id, i) => `<g clip-path="url(#clip-sheet-${id})">${S.sheetSvg(i, "ABC".indexOf(id[0]))}</g>`).join("");
const cards = [0, 1, 2, 3, 4].map((i) => `<g clip-path="url(#clip-card-${i})">${S.cardSvg(i, i === 4)}</g>`).join("");
const clips = [["main", -S.CLIP.off, false, 4], ["draft", S.CLIP.off, true, 2]]
  .map(([name, off, lit, card]) => `<g transform="${k.translateAlong(P, S.offsetTo(S.clipHome(off), S.clipAt(card, off)))}">${S.clipSvg(off, lit)}</g>`)
  .join("");
const books = S.BOOK_X.map((bx, i) => `<g clip-path="url(#clip-book-${i})">${S.bookSvg(bx)}<g transform="${k.translateAlong(P, [(i === 0 ? 4 : 2) * S.TAB_STEP, 0, 0])}">${S.tabSvg(bx)}</g></g>`).join("");
const defs =
  ["A1", "A2", "B1", "B2", "C1", "C2"].map((id, i) => `<clipPath id="clip-sheet-${id}"><path d="${S.sheetClip(i)}"/></clipPath>`).join("") +
  [0, 1, 2, 3, 4].map((i) => `<clipPath id="clip-card-${i}"><path d="${S.cardClip(i)}"/></clipPath>`).join("") +
  S.BOOK_X.map((bx, i) => `<clipPath id="clip-book-${i}"><path d="${S.bookClip(bx)}"/></clipPath>`).join("");

// Number tags: a small disc with the station number, standing on a short post above each station.
function tag(n, x, y, z) {
  const [sx, sy] = k.iso([x, y, z], P);
  return `<g class="tag" data-tag="${n}" transform="translate(${sx.toFixed(1)} ${sy.toFixed(1)})"><circle r="7.5" class="tag-disc"/><text y="3" text-anchor="middle" class="tag-num">${n}</text></g>`;
}
const TAGS = [
  [1, 22, -86, 72], [2, -130, -18, 70], [3, -86, -82, 56], [4, -40, -6, 48], [5, 99, -77, 56], [6, 109, 4, 60], [7, -10, 80, 50],
];

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "A cutaway bookbinder's shop: shop window and door at the front, counter with a card index and two bookmark clips behind it, a printing press on a bench to the left, an archive rack and a bookcase along the back wall, a binding machine and a writing desk with a lamp to the right. Seven numbered tags mark the stations.",
  body: [
    `<defs>${defs}</defs>`,
    S.building(),
    st(1, S.bookcase()),
    st(3, S.rack() + sheets),
    st(2, S.press() + `<g transform="${k.translateAlong(P, [0, 0, 0])}">${S.platenSvg()}</g>` + S.pressTop()),
    st(5, S.desk() + S.lampHead()),
    st(4, S.counter() + cards + clips),
    st(6, S.binder() + `<g>${S.bplatenSvg()}</g>` + S.binderTop()),
    st(7, S.podium() + books + S.windowFrame()),
    TAGS.map(([n, x, y, z]) => tag(n, x, y, z)).join(""),
  ],
});

const live = `
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const readout = document.querySelector("[data-readout]");
const STATIONS = ${JSON.stringify(STATIONS)};
const buttons = [...document.querySelectorAll("[data-pick]")];
let current = 0;
function select(n, { say = true } = {}) {
  current = n;
  svg.toggleAttribute("data-focus", n > 0);
  svg.querySelectorAll(".st").forEach((g) => g.toggleAttribute("data-on", +g.dataset.station === n));
  svg.querySelectorAll(".tag").forEach((g) => g.toggleAttribute("data-on", +g.dataset.tag === n));
  buttons.forEach((b) => b.setAttribute("aria-pressed", +b.dataset.pick === n ? "true" : "false"));
  const s = STATIONS.find((x) => x.n === n);
  const text = s ? "0" + s.n + " " + s.name + " · " + s.tables : "the whole shop · hover a station";
  if (readout.textContent !== text) readout.textContent = text;
  stage.setAttribute("aria-valuetext", s ? s.name + ": " + s.says : "Overview of the shop");
  const cap = document.querySelector("[data-says]");
  if (cap) cap.textContent = s ? s.says : "Each station is one part of the data model. Hover or press 1 to 7.";
}
svg.querySelectorAll(".st, .tag").forEach((g) => {
  g.addEventListener("pointerenter", () => select(+(g.dataset.station || g.dataset.tag)));
});
svg.addEventListener("pointerleave", () => select(0));
buttons.forEach((b) => b.addEventListener("click", () => select(current === +b.dataset.pick ? 0 : +b.dataset.pick)));
stage.addEventListener("keydown", (e) => {
  if (e.key >= "1" && e.key <= "7") { select(+e.key); e.preventDefault(); }
  if (e.key === "ArrowRight") { select(current % 7 + 1); e.preventDefault(); }
  if (e.key === "ArrowLeft") { select((current + 5) % 7 + 1); e.preventDefault(); }
  if (e.key === "Escape") select(0);
});
// Idle tour: walk the stations until someone touches the figure.
let touring = !matchMedia("(prefers-reduced-motion: reduce)").matches, tourAt = 0, timer = 0;
const step = () => { if (!touring) return; tourAt = tourAt % 7 + 1; select(tourAt); timer = setTimeout(step, 2600); };
timer = setTimeout(step, 1400);
["pointerenter", "pointerdown", "keydown", "focusin"].forEach((ev) => stage.addEventListener(ev, () => { touring = false; clearTimeout(timer); }));
select(0);
`;

const body =
  k.plateHtml({
    fig: "Fig 0",
    title: "The shop",
    hint: "Hover a station or press 1 to 7",
    readout: "the whole shop · hover a station",
    keys: [],
    caption: "",
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="Map of the shop: number keys 1 to 7 select a station">${svg}</div>`,
  }) +
  `<div class="picks">${STATIONS.map((s) => `<button type="button" data-pick="${s.n}" aria-pressed="false"><b>0${s.n}</b> ${s.name}</button>`).join("")}</div><p class="says" data-says></p>` +
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
    .says { font: 14px/1.45 system-ui, sans-serif; color: var(--anatomy-muted, var(--anatomy-hi)); margin: 10px 0 0; min-height: 2.9em; }
  </style>`;

writeScene("scene-0", { title: "How createCMS works · Fig 0 The shop", body, script: live });
